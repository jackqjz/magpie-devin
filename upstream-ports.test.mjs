import { expect, test } from "bun:test"
import { _internal as d } from "./index.mjs"
const dec = new TextDecoder()
const prompts = (bytes) => d.fields(bytes).filter((f) => f.num === 3).map((f) => {
  const fs = d.fields(f.data)
  const str = (n) => dec.decode(fs.find((x) => x.num === n)?.data ?? new Uint8Array())
  return { text: str(3), reasoning: str(11), signature: str(12), origin: str(18), result: str(7), cache: fs.some((x) => x.num === 8), role: fs.find((x) => x.num === 2)?.n }
})
const build = (messages) => prompts(d.buildMessages({ model: "claude-opus-5-5", system: "STATIC", messages }, "claude-opus-5-5-high", "test"))
const tool = (id) => ({ type: "tool_use", id, name: "echo", input: {} })
const result = (id) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "result " + id }] })
for (const role of ["system", "developer"]) {
  test(`${role} notice stays after every pending result, keeping its cache mark`, () => {
    const out = build([{ role: "user", content: "TASK" }, { role: "assistant", content: [tool("a"), tool("b")] },
      { role, content: [{ type: "text", text: "NOTICE", cache_control: { type: "ephemeral" } }] }, result("a"), result("b")])
    expect(out.map((x) => x.text)).toEqual(["STATIC", "TASK", "", "result a", "result b", "NOTICE"])
    expect(out.at(-1).cache).toBe(true)
  })
  test(`${role} notice after an interrupted call follows its placeholder`, () => {
    const out = build([{ role: "user", content: "TASK" }, { role: "assistant", content: [tool("a")] }, { role, content: "NOTICE" }, { role: "user", content: "NEXT" }])
    expect(out.findIndex((x) => x.result === "a")).toBeLessThan(out.findIndex((x) => x.text === "NOTICE"))
    expect(out.at(-1).text).toBe("NEXT")
  })
}
test("empty notice does not split parallel assistant calls", () => {
  const out = build([{ role: "user", content: "TASK" }, { role: "assistant", content: [tool("a")] }, { role: "system", content: "" }, { role: "assistant", content: [tool("b")] }, result("a"), result("b")])
  expect(out.filter((x) => x.result).map((x) => x.text)).toEqual(["result a", "result b"])
})
for (const field of ["reasoning_content", "reasoning"]) {
  test(`SWE carries unsigned ${field} without inventing signature metadata`, () => {
    const messages = [{ role: "assistant", content: "reply", [field]: "full reasoning" }]
    const out = prompts(d.build({ model: "swe-2-flash", messages }, "swe-2-flash-medium", "test"))
    expect(out.find((x) => x.role === 2)).toMatchObject({ reasoning: "full reasoning", signature: "", origin: "" })
    expect(prompts(d.build({ model: "claude-opus-5-5", messages }, "claude-opus-5-5-high", "test")).every((x) => !x.reasoning)).toBe(true)
  })
}
test("split calls retain signed and unsigned thoughts separately, Claude drops only unsigned", () => {
  const messages = [{ role: "assistant", content: "first", reasoning_content: "signed", reasoning_signature: "sig", reasoning_origin: "sealed", tool_calls: [{ id: "a", function: { name: "echo", arguments: "{}" } }] }, { role: "assistant", content: "second", reasoning: "unsigned", tool_calls: [{ id: "b", function: { name: "echo", arguments: "{}" } }] }]
  const out = prompts(d.build({ model: "swe-2", messages }, "swe-2-high", "test")).filter((x) => x.role === 2)
  expect(out.map((x) => [x.reasoning, x.signature])).toEqual([["signed", "sig"], ["unsigned", ""]])
  const claude = prompts(d.build({ model: "claude-opus-5-5", messages }, "claude-opus-5-5-high", "test")).filter((x) => x.role === 2)
  expect(claude.map((x) => x.reasoning)).toEqual(["signed"])
})
test("OpenCode 2 retains unsigned reasoning for SWE but not Claude", () => {
  const options = { prompt: [{ role: "assistant", content: [{ type: "reasoning", text: "full thought" }, { type: "text", text: "answer" }] }] }
  const chat = d.v2Chat(options, "swe-2-flash")
  expect(prompts(d.build(chat, "swe-2-flash-medium", "test")).find((x) => x.role === 2).reasoning).toBe("full thought")
  expect(d.v2Chat(options, "claude-opus-5-5").messages[0].devin_thinking).toEqual([])
})
test("fallback catalog keeps SWE-2 and Flash distinct with their native variants", () => {
  const families = d.familiesOf(d.SNAPSHOT)
  expect(d.variantFor(families, "swe-2", "high")).toBe("swe-2-high")
  expect(d.variantFor(families, "swe-2-flash", "medium")).toBe("swe-2-flash-medium")
  expect(d.variantFor([], "swe-2-flash", "medium")).toBe("swe-2-flash-medium")
})
