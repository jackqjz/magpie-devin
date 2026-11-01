// Claude's Messages requests reach Devin shaped as the Devin CLI sends its
// own (captured from CLI 3000.11.3 and the desktop's CLI 3000.11.234):
// blocks kept as prompts of their own, cache marks as
// prompt_cache_options (field 8), signed thinking kept, and a failed tool
// result said in its text. Ported from upstream 0.1.28/0.1.29, except that
// signed thinking is retained instead of dropped.
import { expect, test } from "bun:test"
import { _internal as d } from "./index.mjs"

const dec = new TextDecoder()
const model = "claude-opus-5-5"
const mark = { type: "ephemeral" }

const prompts = (b) =>
  d
    .fields(b)
    .filter((f) => f.num === 3 && f.wire === 2)
    .map((f) => {
      const m = { role: 0, text: "", calls: 0, answers: "", cache: false, signature: "", images: 0 }
      for (const g of d.fields(f.data)) {
        if (g.num === 2) m.role = g.n
        else if (g.num === 3) m.text = dec.decode(g.data)
        else if (g.num === 6) m.calls++
        else if (g.num === 7) m.answers = dec.decode(g.data)
        else if (g.num === 8) m.cache = d.fields(g.data).some((x) => x.num === 1 && x.n === 1)
        else if (g.num === 10) m.images++
        else if (g.num === 12) m.signature = dec.decode(g.data)
      }
      return m
    })

const built = (req) => prompts(d.buildMessages({ model, max_tokens: 4096, ...req }, "claude-opus-5-5-high", "test"))

test("user and system blocks stay separate prompts, never joined", () => {
  const p = built({
    system: [{ type: "text", text: "sys one" }, { type: "text", text: "sys two" }],
    messages: [{ role: "user", content: [{ type: "text", text: "first block" }, { type: "text", text: "second block" }] }],
  })
  expect(p.map((m) => [m.role, m.text])).toEqual([[1, "sys one"], [1, "sys two"], [1, "first block"], [1, "second block"]])
})

test("cache_control becomes prompt_cache_options only where the client marked", () => {
  const p = built({
    system: [{ type: "text", text: "static", cache_control: mark }],
    messages: [
      { role: "user", content: [{ type: "text", text: "ctx" }, { type: "text", text: "task" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "shell", input: { command: "cat" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "out", cache_control: mark }] },
    ],
    tools: [{ name: "shell", input_schema: { type: "object" } }],
  })
  expect(p.map((m) => m.cache)).toEqual([true, false, false, false, true])
  expect(p.at(-1).answers).toBe("c1")
  // the encoded bytes carry field 8 {1: 1}, the desktop CLI's encoding
  const raw = Buffer.from(d.buildMessages({ model, messages: [{ role: "user", content: [{ type: "text", text: "x", cache_control: mark }] }] }, "u", "k"))
  expect(raw.includes(Buffer.from([0x42, 0x02, 0x08, 0x01]))).toBe(true)
})

test("a mark on the last tool result block or the tools reaches its prompt", () => {
  const p = built({
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "shell", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: [{ type: "text", text: "out", cache_control: mark }] }] },
    ],
    tools: [{ name: "shell", description: "run it", input_schema: { type: "object" }, cache_control: mark }],
  })
  expect(p[0].text.startsWith("<tool_descriptions>")).toBe(true)
  expect(p[0].cache).toBe(true)
  expect(p.at(-1).cache).toBe(true)
  expect(p.filter((m) => m.cache).length).toBe(2)
})

test("a failed tool result says Error: in its text; a successful one does not", () => {
  const p = built({
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "tool_use", id: "a", name: "shell", input: {} }, { type: "tool_use", id: "b", name: "shell", input: {} }] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "a", content: "command failed", is_error: true },
        { type: "tool_result", tool_use_id: "b", content: "ok" },
      ] },
    ],
  })
  expect(p.filter((m) => m.answers).map((m) => m.text)).toEqual(["Error: command failed", "ok"])
})

test("an empty failed result still says it failed", () => {
  const p = built({
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "tool_use", id: "a", name: "shell", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: [], is_error: true }] },
    ],
  })
  expect(p.at(-1).text).toBe("Error: (no output)")
})

test("an assistant turn is one message with its text, calls and signed thought, as the CLI sends it", () => {
  const p = built({
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [
        { type: "thinking", thinking: "plan", signature: "sig" },
        { type: "text", text: "reading" },
        { type: "tool_use", id: "c", name: "shell", input: {} },
      ] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c", content: "out" }] },
    ],
  })
  const reply = p.filter((m) => m.role === 2)
  expect(reply.length).toBe(1)
  expect(reply[0]).toMatchObject({ text: "reading", calls: 1, signature: "sig" })
})

test("unsigned thinking is never replayed, and a turn split in two stays one turn", () => {
  const p = built({
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "thinking", thinking: "plain" }, { type: "tool_use", id: "a", name: "one", input: {} }] },
      { role: "assistant", content: [{ type: "tool_use", id: "b", name: "two", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "A" }, { type: "tool_result", tool_use_id: "b", content: "B" }] },
    ],
  })
  expect(p.filter((m) => m.signature).length).toBe(0)
  expect(p.filter((m) => m.role === 2).map((m) => m.calls)).toEqual([2])
  expect(p.filter((m) => m.answers).map((m) => m.text)).toEqual(["A", "B"])
})

test("dropping unsigned thinking does not split the reply's text from its calls", () => {
  const p = built({
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "text", text: "a" }, { type: "thinking", thinking: "plain" }, { type: "tool_use", id: "c", name: "x", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c", content: "out" }] },
    ],
  })
  expect(p.filter((m) => m.role === 2).map((m) => [m.text, m.calls])).toEqual([["a", 1]])
})

test("Claude Code's per-turn billing line is not sent", () => {
  const p = built({
    system: [{ type: "text", text: "x-anthropic-billing-header: cc_version=1; cch=abc;\n" }, { type: "text", text: "real" }],
    messages: [{ role: "user", content: "go" }],
  })
  expect(p.map((m) => m.text)).toEqual(["real", "go"])
})

test("effort comes from output_config, else the thinking budget", () => {
  expect(d.anthropicEffort({ output_config: { effort: "high" } })).toBe("high")
  expect(d.anthropicEffort({ thinking: { type: "enabled", budget_tokens: 3000 } })).toBe("low")
  expect(d.anthropicEffort({ thinking: { type: "enabled", budget_tokens: 30000 } })).toBe("xhigh")
  expect(d.anthropicEffort({ thinking: { type: "disabled" } })).toBe("")
})

test("unsupported blocks are refused, not silently dropped", () => {
  expect(() => built({ messages: [{ role: "user", content: [{ type: "document", source: {} }] }] })).toThrow()
  expect(() => built({ messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://x" } }] }] })).toThrow()
  expect(() => built({ messages: [{ role: "user", content: "go" }], tools: [{ type: "web_search_20250305", name: "web_search" }] })).toThrow()
})
