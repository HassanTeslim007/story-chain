import { describe, expect, it } from "vitest";
import { escapeControlCharsInStrings } from "./claude";

describe("escapeControlCharsInStrings", () => {
  it("leaves well-formed JSON untouched", () => {
    const input = `{"sentence": "A perfectly normal sentence."}`;
    expect(escapeControlCharsInStrings(input)).toBe(input);
    expect(() => JSON.parse(escapeControlCharsInStrings(input))).not.toThrow();
  });

  it("escapes a raw newline inside a string value", () => {
    // V8 calls this "Bad control character in string literal" - a genuinely
    // truncated response (never reaches a closing quote) is the other,
    // separate failure this sanitizer can't fix, and throws the more
    // familiar "Unterminated string in JSON" instead.
    const broken = '{"sentence": "She said hello,\nthen left."}';
    expect(() => JSON.parse(broken)).toThrow(/Bad control character/);
    const fixed = escapeControlCharsInStrings(broken);
    expect(JSON.parse(fixed)).toEqual({ sentence: "She said hello,\nthen left." });
  });

  it("escapes raw tabs and carriage returns inside a string value", () => {
    const broken = '{"sentence": "Tab:\there\r\nreturn."}';
    const fixed = escapeControlCharsInStrings(broken);
    expect(JSON.parse(fixed)).toEqual({ sentence: "Tab:\there\r\nreturn." });
  });

  it("doesn't touch whitespace between JSON tokens, only inside strings", () => {
    const input = '{\n  "sentence":\n"fine"\n}';
    expect(escapeControlCharsInStrings(input)).toBe(input);
    expect(JSON.parse(escapeControlCharsInStrings(input))).toEqual({ sentence: "fine" });
  });

  it("respects escaped quotes and backslashes when tracking string boundaries", () => {
    const input = String.raw`{"sentence": "She said \"hi\" and left a \\ mark."}`;
    expect(escapeControlCharsInStrings(input)).toBe(input);
    expect(JSON.parse(escapeControlCharsInStrings(input))).toEqual({
      sentence: 'She said "hi" and left a \\ mark.',
    });
  });
});
