import test from "node:test"
import assert from "node:assert/strict"
import { _internal as d } from "./index.mjs"

const { PB } = d
const dec = new TextDecoder()
const families = d.familiesOf(d.SNAPSHOT)
const auth = { key: "test-credential", server: "https://example.invalid", families }
const model = "claude-opus-5-5"
const thought = { text: "先读取订单，再核对整数分。", signature: "test-signature-only", origin: "anthropic" }
const parts = (data) => d.fields(data)
const val = (fields, num) => dec.decode(fields.find((f) => f.num === num)?.data ?? new Uint8Array())
const messages = (data) => parts(data).filter((f) => f.num === 3).map((f) => parts(f.data))
const signed = (data) => messages(data).filter((f) => val(f, 12)).map((f) => ({ text: val(f, 11), signature: val(f, 12), origin: val(f, 18) }))
async function* input(rows, end = {}) {
  for (const data of rows) yield { data: data.done(), end: false }
  yield { data: new TextEncoder().encode(JSON.stringify(end)), end: true }
}
const collect = async (it) => { const out = []; for await (const x of it) out.push(x); return out }
const rows = (b = thought) => [new PB().str(9, b.text), new PB().str(10, b.signature).str(21, b.origin),
  new PB().str(3, "开始读取。"), new PB().bytes(6, new PB().str(1, "Bash:0#abc").str(2, "shell").str(3, '{"command":"cat inputs/order.json"}')),
  new PB().varint(5, 10).bytes(7, new PB().varint(2, 10).varint(3, 20).varint(4, 3).varint(5, 4))]
function response(rows, end = {}) {
  const tail = Buffer.from(JSON.stringify(end)), footer = Buffer.alloc(5)
  footer[0] = 2; footer.writeUInt32BE(tail.length, 1)
  return new Response(Buffer.concat([...rows.map((p) => Buffer.from(d.frame(p.done()))), footer, tail]), { headers: { "Content-Type": "application/connect+proto" } })
}
function mock(t, rows, end = {}) {
  const original = globalThis.fetch, requests = []
  globalThis.fetch = async (url, init) => { requests.push({ url, init }); return response(rows, end) }
  t.after(() => { globalThis.fetch = original })
  return requests
}
const request = (extra = {}) => ({ model, stream: false, max_tokens: 4096, output_config: { effort: "high" },
  messages: [{ role: "user", content: "请读取订单。" }], tools: [{ name: "shell", input_schema: { type: "object", properties: { command: { type: "string" } } } }], ...extra })
async function sse(res) {
  return (await res.text()).split("\n").filter((s) => s.startsWith("data: ") && s !== "data: [DONE]").map((s) => JSON.parse(s.slice(6)))
}

for (const stream of [false, true]) test(`unsigned SWE Flash native reasoning survives Responses tool loop, stream=${stream}`, async (t) => {
  mock(t, [new PB().str(9, "native full thought"), new PB().bytes(6, new PB().str(1, "c").str(2, "echo").str(3, "{}")), new PB().varint(5, 10)])
  const req = { model: "swe-2-flash", stream, reasoning: { effort: "medium" }, input: [{ role: "user", content: "go" }], tools: [{ type: "function", name: "echo", parameters: { type: "object" } }] }
  const res = await d.completeResponses(auth, req)
  assert.equal(res.status, 200)
  const output = stream ? (await sse(res)).find((e) => e.type === "response.completed").response.output : (await res.json()).output
  const state = output.find((e) => e.encrypted_content)?.encrypted_content
  assert.ok(state?.startsWith("dvru1_"))
  assert.deepEqual(d.openThinking(state, auth.key), { text: "native full thought" })
  assert.throws(() => d.openThinking(state, "different-account"))
  assert.throws(() => d.openThinking(state.replace("dvru1_", "dvrs1_"), auth.key))
  const input = [...req.input, ...output, { type: "function_call_output", call_id: "c", output: "ok" }]
  const built = messages(d.build(d.responsesChat({ ...req, input }, auth.key), "swe-2-flash-medium", "test"))
  assert.deepEqual(built.filter((f) => val(f, 11)).map((f) => [val(f, 11), val(f, 12), val(f, 18)]), [["native full thought", "", ""]])
})
test("foreign Responses summaries are not treated as full unsigned thoughts", () => {
  const chat = d.responsesChat({ model: "swe-2-flash", input: [{ type: "reasoning", summary: [{ type: "summary_text", text: "foreign summary" }] }, { role: "assistant", content: "reply" }] }, auth.key)
  assert.ok(messages(d.build(chat, "swe-2-flash-medium", "test")).every((f) => !val(f, 11)))
})

test("signed thought keeps text, signature and origin together", async () => {
  const out = await collect(d.events(input(rows())))
  assert.deepEqual(out.filter((e) => e.signed).map((e) => e.signed), [thought])
  assert.equal(out.filter((e) => e.reasoning).map((e) => e.reasoning).join(""), thought.text)
  assert.ok(out.findIndex((e) => e.signed) < out.findIndex((e) => e.tool))
})
test("signature fragments and a separate origin frame stay paired", async () => {
  const out = await collect(d.events(input([new PB().str(9, "想法"), new PB().str(10, "abc"), new PB().str(10, "def"), new PB().str(21, "anthropic")])))
  assert.deepEqual(out.filter((e) => e.signed).map((e) => e.signed), [{ text: "想法", signature: "abcdef", origin: "anthropic" }])
})
test("SWE can sign reasoning after visible text without losing its original thought", async () => {
  const out = await collect(d.events(input([new PB().str(9, thought.text), new PB().str(3, "read now"), new PB().str(10, thought.signature).str(21, "sealed")])))
  assert.deepEqual(out.find((e) => e.signed)?.signed, { ...thought, origin: "sealed" })
})
test("multiple thoughts never concatenate signatures or borrow the prior origin", async () => {
  const out = await collect(d.events(input([new PB().str(9, "one"), new PB().str(10, "first").str(21, "anthropic"), new PB().str(9, "two"), new PB().str(10, "second")])))
  assert.deepEqual(out.filter((e) => e.signed).map((e) => e.signed), [
    { text: "one", signature: "first", origin: "anthropic" }, { text: "two", signature: "second", origin: "" }])
})
test("signed thought with no visible text is retained", async () => {
  const empty = { ...thought, text: "" }
  const out = await collect(d.events(input([new PB().str(10, empty.signature).str(21, empty.origin)])))
  assert.deepEqual(out.find((e) => e.signed)?.signed, empty)
  assert.ok(!out.some((e) => e.error))
  assert.deepEqual(signed(d.build({ messages: [{ role: "assistant", devin_thinking: [empty] }] }, model, "test")), [empty])
})
test("unsigned reasoning never acquires a signature", async () => {
  const out = await collect(d.events(input([new PB().str(9, "plain reasoning"), new PB().str(3, "answer")])))
  assert.ok(!out.some((e) => e.signed))
  assert.deepEqual(signed(d.build({ messages: [{ role: "assistant", content: "answer", reasoning_content: "plain reasoning" }] }, model, "test")), [])
})
test("empty metadata-only reply still fails", async () => {
  const out = await collect(d.events(input([new PB().bytes(7, new PB().varint(3, 123))])))
  assert.equal(out.at(-1).error.status, 502)
})

for (const stream of [false, true]) {
  test(`Messages signed tool loop round trip, stream=${stream}`, async (t) => {
    const sent = mock(t, rows())
    const res = await d.completeAnthropic(auth, request({ stream }))
    assert.equal(res.status, 200)
    let content
    if (stream) {
      const events = await sse(res)
      const blocks = new Map()
      for (const e of events) {
        if (e.type === "content_block_start") blocks.set(e.index, structuredClone(e.content_block))
        if (e.type !== "content_block_delta") continue
        const b = blocks.get(e.index), delta = e.delta
        if (delta.type === "thinking_delta") b.thinking += delta.thinking
        else if (delta.type === "signature_delta") b.signature += delta.signature
        else if (delta.type === "text_delta") b.text += delta.text
        else if (delta.type === "input_json_delta") b._args = (b._args ?? "") + delta.partial_json
      }
      content = [...blocks.values()].map((b) => { if (b._args) { b.input = JSON.parse(b._args); delete b._args } return b })
      assert.equal(events.at(-1).type, "message_stop")
      assert.equal(events.find((e) => e.type === "message_delta").delta.stop_reason, "tool_use")
    } else {
      const body = await res.json()
      content = body.content
      assert.equal(body.stop_reason, "tool_use")
      assert.equal(body.usage.input_tokens, 10)
      assert.equal(body.usage.cache_read_input_tokens, 4)
      assert.equal(body.usage.cache_creation_input_tokens, 3)
    }
    assert.deepEqual(content.find((b) => b.type === "thinking"), { type: "thinking", thinking: thought.text, signature: thought.signature })
    const call = content.find((b) => b.type === "tool_use")
    const built = d.buildMessages(request({ messages: [...request().messages,
      { role: "assistant", content }, { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: "read output" }] }] }), "claude-opus-5-5-high", "test")
    assert.deepEqual(signed(built), [thought])
    assert.equal(val(messages(built).find((f) => val(f, 7)), 7), "Bash:0#abc")
    assert.equal(sent[0].init.headers.Authorization, "Basic test-credential-test-credential")
  })
  test(`Chat completion exposes original signed metadata, stream=${stream}`, async (t) => {
    mock(t, rows())
    const res = await d.complete(auth, { model, stream, messages: [{ role: "user", content: "read" }] })
    if (stream) {
      const data = await sse(res)
      const delta = data.map((e) => e.choices?.[0]?.delta).find((e) => e?.devin_thinking)
      assert.deepEqual(delta.devin_thinking, [thought])
      assert.equal(delta.reasoning_signature, thought.signature)
    } else {
      const msg = (await res.json()).choices[0].message
      assert.deepEqual(msg.devin_thinking, [thought])
      assert.deepEqual(signed(d.build({ messages: [{ role: "user", content: "read" }, msg] }, model, "test")), [thought])
    }
  })
  test(`SWE chat text/tool decoding stays available, stream=${stream}`, async (t) => {
    mock(t, [new PB().str(3, "okay"), new PB().varint(5, 1)])
    const res = await d.complete(auth, { model: "swe-2", stream, messages: [{ role: "user", content: "hello" }] })
    assert.equal(res.status, 200)
    if (stream) assert.equal((await sse(res)).find((e) => e.choices?.[0]?.delta?.content)?.choices[0].delta.content || "", "okay")
    else assert.equal((await res.json()).choices[0].message.content, "okay")
  })
}

test("Claude and SWE-2 route signed state through the appropriate API", () => {
  for (const id of ["claude-opus-5-5", "claude-opus-5-5-high-fast", "claude-sonnet-5-5"]) {
    const m = { id, name: id, efforts: ["high"], image: true }
    assert.equal(d.runtimeModel(m).api.npm, "@ai-sdk/anthropic")
    assert.equal(d.configModel(m).provider.npm, "@ai-sdk/anthropic")
    assert.deepEqual(d.runtimeModel(m).variants.high, { effort: "high" })
  }
  for (const id of ["swe-2", "swe-2-high-lightning"]) assert.equal(d.runtimeModel({ id, name: id, efforts: ["high"], image: true }).api.npm, "@ai-sdk/openai")
  for (const id of ["swe-1.7", "gpt-6-1-sol", "gemini-4-argon", "deepseek-v4-pro"]) {
    const m = { id, name: id, efforts: ["high"], image: true }
    assert.equal(d.runtimeModel(m).api.npm, "@ai-sdk/openai-compatible")
    assert.deepEqual(d.runtimeModel(m).variants.high, { reasoningEffort: "high" })
  }
})
test("split parallel tool calls retain each signed block and actual tool results", () => {
  const msgs = [{ role: "user", content: "read" },
    { role: "assistant", devin_thinking: [thought], tool_calls: [{ id: "a", function: { name: "one", arguments: "{}" } }] },
    { role: "assistant", devin_thinking: [{ ...thought, signature: "second" }], tool_calls: [{ id: "b", function: { name: "two", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "a", content: "result a" }, { role: "tool", tool_call_id: "b", content: "result b" }]
  const built = d.build({ messages: msgs }, model, "test")
  assert.deepEqual(signed(built), [thought, { ...thought, signature: "second" }])
  assert.deepEqual(messages(built).filter((f) => val(f, 7)).map((f) => val(f, 3)), ["result a", "result b"])
})
test("multiple Anthropic thoughts stay distinct in protobuf history", () => {
  const built = d.buildMessages(request({ messages: [{ role: "assistant", content: [
    { type: "thinking", thinking: "one", signature: "sig1" }, { type: "thinking", thinking: "two", signature: "sig2" },
    { type: "text", text: "done" }] }] }), model, "test")
  assert.deepEqual(signed(built), [
    { text: "one", signature: "sig1", origin: "anthropic" }, { text: "two", signature: "sig2", origin: "anthropic" }])
})
test("tool result images stay on the tool result", () => {
  const built = d.buildMessages(request({ messages: [{ role: "user", content: "read" },
    { role: "assistant", content: [{ type: "tool_use", id: "c", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c", content: [{ type: "text", text: "image" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } }] }] }] }), model, "test")
  const result = messages(built).find((f) => val(f, 7) === "c")
  assert.equal(result.filter((f) => f.num === 10).length, 1)
  assert.equal(val(result, 3), "image")
})
test("unsupported opaque redacted thinking is rejected without an upstream send", async (t) => {
  const sent = mock(t, rows())
  const res = await d.completeAnthropic(auth, request({ messages: [{ role: "assistant", content: [{ type: "redacted_thinking", data: "opaque" }] }] }))
  assert.equal(res.status, 400)
  assert.equal((await res.json()).type, "error")
  assert.equal(sent.length, 0)
})
test("V3 reasoning metadata is returned to original protobuf fields", () => {
  const prompt = [{ role: "assistant", content: [{ type: "reasoning", text: thought.text, providerOptions: { devin: { signature: thought.signature, origin: thought.origin } } },
    { type: "tool-call", toolCallId: "c", toolName: "read", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c", output: { type: "text", value: "output" } }] }]
  assert.deepEqual(signed(d.build(d.v2Chat({ prompt }, model), model, "test")), [thought])
})
test("Connect stream errors never turn into a successful Messages ending", async (t) => {
  mock(t, rows().slice(0, 2), { error: { code: "unavailable", message: "upstream stopped" } })
  const out = await sse(await d.completeAnthropic(auth, request({ stream: true })))
  assert.equal(out.at(-1).type, "error")
  assert.ok(!out.some((e) => e.type === "message_stop"))
})
test("Messages cancellation closes the underlying response iterator", async () => {
  let closed = false
  async function* source() { try { yield { reasoning: "thinking" }; yield { text: "answer" } } finally { closed = true } }
  const it = d.anthropicEvents(source(), model)
  await it.next(); await it.next(); await it.return()
  assert.equal(closed, true)
})
test("nonstreaming Messages keeps the actual upstream error status", async (t) => {
  mock(t, [new PB().str(9, "partial")], { error: { code: "resource_exhausted", message: "quota reached" } })
  const res = await d.completeAnthropic(auth, request())
  assert.equal(res.status, 429)
  assert.equal((await res.json()).error.type, "rate_limit_error")
})
test("unknown signed origin is not silently relabelled as Anthropic", async (t) => {
  mock(t, rows({ ...thought, origin: "another-provider" }))
  const res = await d.completeAnthropic(auth, request())
  assert.equal(res.status, 502)
  assert.equal((await res.json()).type, "error")
})
for (const stream of [false, true]) {
  test(`V3 output carries the actual signature in provider metadata, stream=${stream}`, async (t) => {
    d.forgetSaid()
    const original = globalThis.fetch
    const config = new PB().bytes(1, new PB().str(1, "Claude Opus 5.5 High").str(22, "claude-opus-5-5-high").varint(5, 1)
      .bytes(23, new PB().str(23, model).varint(13, 4096)))
    globalThis.fetch = async (url) => String(url).endsWith("/GetCliModelConfigs") ? new Response(config.done()) : response(rows())
    t.after(() => { globalThis.fetch = original; d.forgetSaid() })
    const language = d.devinLanguage(model, async () => ({ type: "api", key: "v3-fixture-key", metadata: { server: "https://example.invalid" } }))
    const options = { prompt: [{ role: "user", content: [{ type: "text", text: "read" }] }] }
    let metadata
    if (stream) {
      const result = await language.doStream(options)
      const events = await collect(result.stream)
      metadata = events.find((e) => e.type === "reasoning-end" && e.providerMetadata)?.providerMetadata
      assert.equal(events.filter((e) => e.type === "reasoning-end").length, 1)
      assert.equal(events.at(-1).type, "finish")
    } else {
      const result = await language.doGenerate(options)
      const part = result.content.find((p) => p.type === "reasoning")
      assert.equal(part.text, thought.text)
      metadata = part.providerMetadata
    }
    assert.deepEqual(metadata, { devin: { signature: thought.signature, origin: thought.origin } })
  })
}
test("opaque state is authenticated, account scoped and independent of a process cache", () => {
  const original = { ...thought, origin: "sealed" }
  const sealed = d.sealThinking(original, "account-one")
  assert.ok(!sealed.includes(original.text) && !sealed.includes(original.signature))
  assert.deepEqual(d.openThinking(sealed, "account-one"), original)
  assert.throws(() => d.openThinking(sealed, "account-two"), /another account/)
  assert.throws(() => d.openThinking(sealed.slice(0, 18) + (sealed[18] === "a" ? "b" : "a") + sealed.slice(19), "account-one"), /damaged/)
  assert.throws(() => d.openThinking("foreign-state", "account-one"), /not from this/)
})
for (const stream of [false, true]) {
  test(`SWE signed Responses tool round trip, stream=${stream}`, async (t) => {
    const original = { ...thought, origin: "sealed" }
    const data = rows(original)
    mock(t, [data[0], data[2], data[1], ...data.slice(3)])
    const req = { model: "swe-2", stream, input: "read", reasoning: { effort: "high" } }
    const res = await d.completeResponses(auth, req)
    assert.equal(res.status, 200)
    const body = stream ? (await sse(res)).find((e) => e.type === "response.completed").response : await res.json()
    const reasoning = body.output.find((e) => e.type === "reasoning" && e.encrypted_content)
    assert.deepEqual(d.openThinking(reasoning.encrypted_content, auth.key), original)
    // Summaries may be omitted by the client: the sealed item remains
    // sufficient to return the exact original bytes, even after restart.
    const input = [{ role: "user", content: "read" }, ...body.output.map((e) => e.type === "reasoning" ? { ...e, summary: [] } : e),
      ...body.output.filter((e) => e.type === "function_call").map((e) => ({ type: "function_call_output", call_id: e.call_id, output: "output" }))]
    const built = d.build(d.responsesChat({ ...req, input }, auth.key), "swe-2-high", "test")
    assert.deepEqual(signed(built), [original])
    assert.equal(val(messages(built).find((f) => val(f, 7)), 7), "Bash:0#abc")
  })
}
test("foreign encrypted history is refused before a model send", async (t) => {
  const sent = mock(t, rows())
  const res = await d.completeResponses(auth, { model: "swe-2", input: [{ type: "reasoning", encrypted_content: d.sealThinking(thought, "different-account") }] })
  assert.equal(res.status, 400)
  assert.equal(sent.length, 0)
})
test("Responses state retains separate thoughts and their original origins", () => {
  const blocks = [thought, { text: "", signature: "native-sealed-blob", origin: "sealed" }]
  const input = blocks.map((b) => ({ type: "reasoning", encrypted_content: d.sealThinking(b, auth.key) }))
  input.push({ type: "function_call", call_id: "one", name: "read", arguments: "{}" }, { type: "function_call_output", call_id: "one", output: "done" })
  assert.deepEqual(signed(d.build(d.responsesChat({ model: "swe-2", input }, auth.key), "swe-2-high", "test")), blocks)
})
for (const kind of ["custom", "namespace", "tool_search"]) {
  test(`Responses preserves Codex ${kind} tool calls and results`, async (t) => {
    const schema = { type: "object", properties: { cmd: { type: "string" } } }
    const tool = kind === "custom" ? { type: "custom", name: "apply_patch", format: { type: "grammar", syntax: "lark", definition: "start: TEXT" } }
      : kind === "namespace" ? { type: "namespace", name: "functions", tools: [{ type: "function", name: "shell", parameters: schema }] }
      : { type: "tool_search", execution: "client", parameters: schema }
    const flat = kind === "custom" ? "apply_patch" : kind === "namespace" ? "functions__shell" : "tool_search"
    const args = kind === "custom" ? JSON.stringify({ input: "*** Begin Patch\n*** End Patch" }) : '{"cmd":"read"}'
    mock(t, [new PB().bytes(6, new PB().str(1, "call_one").str(2, flat).str(3, args)), new PB().varint(5, 10)])
    const req = { model: "swe-2", stream: true, input: "read", tools: [tool] }
    const output = (await sse(await d.completeResponses(auth, req))).find((e) => e.type === "response.completed").response.output
    const call = output[0]
    assert.equal(call.type, kind === "custom" ? "custom_tool_call" : kind === "tool_search" ? "tool_search_call" : "function_call")
    if (kind === "custom") assert.equal(call.input, "*** Begin Patch\n*** End Patch")
    if (kind === "namespace") { assert.equal(call.namespace, "functions"); assert.equal(call.name, "shell") }
    const result = { type: kind === "custom" ? "custom_tool_call_output" : kind === "tool_search" ? "tool_search_output" : "function_call_output", call_id: call.call_id,
      output: "result", ...(kind === "tool_search" ? { tools: [{ type: "function", name: "found", parameters: schema }] } : {}) }
    const follow = d.responsesChat({ ...req, input: [...output, result] }, auth.key)
    const built = d.build(follow, "swe-2-high", "test")
    const assistant = messages(built).find((f) => f.some((x) => x.num === 6))
    const sentCall = d.fields(assistant.find((f) => f.num === 6).data)
    assert.equal(val(sentCall, 2), flat)
    assert.equal(val(sentCall, 3), args)
    assert.ok(messages(built).some((f) => val(f, 7) === "call_one"))
    if (kind === "tool_search") assert.ok(follow.tools.some((t) => t.function.name === "found"))
  })
}
