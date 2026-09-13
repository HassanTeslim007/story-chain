import { describe, expect, it } from "vitest";
import { parseAiSentence, parseOpeningLines, parseScoreResponse } from "./claude";

describe("parseOpeningLines", () => {
  it("splits a well-formed multi-line opening", () => {
    const text = "First sentence.\nSecond sentence.\nThird sentence.";
    expect(parseOpeningLines(text)).toEqual(["First sentence.", "Second sentence.", "Third sentence."]);
  });

  it("strips numbering and bullet markers the model added despite instructions", () => {
    const text = "1. First sentence.\n- Second sentence.\n* Third sentence.";
    expect(parseOpeningLines(text)).toEqual(["First sentence.", "Second sentence.", "Third sentence."]);
  });

  it("ignores blank lines", () => {
    const text = "First sentence.\n\nSecond sentence.\n\nThird sentence.\n";
    expect(parseOpeningLines(text)).toHaveLength(3);
  });

  it("throws when fewer than 3 sentences are returned", () => {
    expect(() => parseOpeningLines("Only one sentence.")).toThrow();
  });

  it("throws when more than 5 sentences are returned", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Sentence ${i}.`).join("\n");
    expect(() => parseOpeningLines(text)).toThrow();
  });

  it("throws on derailed output containing stray braces", () => {
    const text = "First sentence.\n{garbage}\nThird sentence.";
    expect(() => parseOpeningLines(text)).toThrow();
  });
});

describe("parseAiSentence", () => {
  it("returns a plain sentence unchanged", () => {
    expect(parseAiSentence("She opened the door slowly.")).toBe("She opened the door slowly.");
  });

  it("strips wrapping double quotes the model added despite instructions", () => {
    expect(parseAiSentence('"She opened the door slowly."')).toBe("She opened the door slowly.");
  });

  it("strips wrapping single quotes", () => {
    expect(parseAiSentence("'She opened the door slowly.'")).toBe("She opened the door slowly.");
  });

  it("preserves an internal quote that isn't a wrapping pair", () => {
    expect(parseAiSentence('She said "hello" and left.')).toBe('She said "hello" and left.');
  });

  it("throws on an empty response", () => {
    expect(() => parseAiSentence("   ")).toThrow();
  });

  it("throws on derailed output containing stray braces", () => {
    expect(() => parseAiSentence("She opened the {door}.")).toThrow();
  });
});

describe("parseScoreResponse", () => {
  it("parses a well-formed response", () => {
    const text = "SCORE: 78\nREASONING: A vivid, coherent continuation.";
    expect(parseScoreResponse(text)).toEqual({ score: 78, reasoning: "A vivid, coherent continuation." });
  });

  it("takes everything after REASONING: verbatim, including quotes and newlines", () => {
    const text = 'SCORE: 42\nREASONING: She said "hello,"\nthen left - no escaping needed here.';
    expect(parseScoreResponse(text)).toEqual({
      score: 42,
      reasoning: 'She said "hello,"\nthen left - no escaping needed here.',
    });
  });

  it("is case-insensitive on the field labels", () => {
    const text = "score: 60\nreasoning: fine.";
    expect(parseScoreResponse(text)).toEqual({ score: 60, reasoning: "fine." });
  });

  it("throws when the score is missing", () => {
    expect(() => parseScoreResponse("REASONING: no score given.")).toThrow();
  });

  it("throws when the score is out of range", () => {
    expect(() => parseScoreResponse("SCORE: 150\nREASONING: too high.")).toThrow();
  });

  it("throws when reasoning is missing", () => {
    expect(() => parseScoreResponse("SCORE: 80")).toThrow();
  });
});
