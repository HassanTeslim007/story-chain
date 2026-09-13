import type { Difficulty } from "./types";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const JUDGE_MODEL = "deepseek-flash";

// Models occasionally derail and produce token soup (stray braces, mixed
// scripts) or leftover JSON habits. Real prose never contains curly braces
// or 40+ char unbroken runs, so this catches it cheaply without a second
// model call to judge the judge.
function isClean(text: string): boolean {
  if (/[{}]/.test(text)) return false;
  if (/\S{40,}/.test(text)) return false;
  return true;
}

// Models asked for "just the sentence" often wrap it in quotes anyway,
// despite being told not to - strip one matching pair if present.
function stripWrappingQuotes(text: string): string {
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"], // “ ”
  ];
  for (const [open, close] of pairs) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

// Defensive against the model ignoring "no numbering/bullets" instructions.
function stripListMarker(line: string): string {
  return line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s*/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A 4xx means the request itself is wrong (bad key, bad payload) - retrying
// changes nothing, so it's thrown immediately instead of burning attempts.
// Everything else (network failures, 5xx, malformed output) is retried by
// default - it's easy to forget to mark a new failure mode as retryable, but
// impossible to forget this one, since it's the only type that skips retry.
class NonRetryableError extends Error {}

// Kept tight on purpose: this runs on Vercel Hobby, where the function
// timeout may or may not actually honor the maxDuration export set on each
// route (that's plan/rollout-dependent, not something confirmed here). Worst
// case per call is ~12.3s (attempt + 300ms backoff + retry) instead of
// unbounded - resolveAiTurn chains two of these, so if Hobby's ceiling turns
// out to be a hard, unconfigurable 10s regardless of maxDuration, that one
// route can still lose the race. The ai-turn effect's own client-side retry
// (app/session/[code]/page.tsx) and the anti-stall timeout fallback mean
// that degrades to a retried/eventually-eliminated AI turn rather than
// corrupted game state - but the real fix at that point would be splitting
// the AI's turn into two separate round trips, not more tuning here.
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 6000;

// DeepSeek's JSON mode is prompt-based, not schema-enforced - their own docs
// note it can even return empty content. Rather than ask for JSON and then
// defend against every way a model can mangle it (unescaped quotes, raw
// control characters, truncation), these calls ask for plain text and parse
// it with a small format-specific function instead. The trick that makes
// this robust: the free-text field (a sentence, the judge's reasoning) is
// always last, so it just consumes everything remaining - nothing after it
// to protect, so nothing in it needs escaping, no matter what characters
// the model writes.
async function callDeepSeek<T>(
  system: string,
  user: string,
  maxTokens: number,
  parse: (text: string) => T,
): Promise<T> {
  let lastError: Error = new Error("DeepSeek call failed");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        signal: timeoutController.signal,
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: JUDGE_MODEL,
          max_tokens: maxTokens,
          temperature: 0.7,
          // deepseek-flash is a hybrid model with thinking mode ON by
          // default - it spends the max_tokens budget on hidden
          // reasoning_content first, and for these short creative/judging
          // tasks that reasoning can consume the whole budget before ever
          // writing an answer, returning empty content with
          // finish_reason: "length". Disabling it fixed that outright in
          // testing (confirmed via a direct API call) and is very likely
          // the real cause of most "malformed output" retries seen before
          // this - not JSON escaping, which was treating the symptom.
          thinking: { type: "disabled" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!response.ok) {
        const message = `DeepSeek request failed: ${response.status} ${await response.text()}`;
        throw response.status >= 400 && response.status < 500 ? new NonRetryableError(message) : new Error(message);
      }
      const data = await response.json();
      return parse(data.choices[0].message.content as string);
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastError =
        err instanceof Error && err.name === "AbortError"
          ? new Error(`DeepSeek did not respond within ${REQUEST_TIMEOUT_MS}ms`)
          : err instanceof Error
            ? err
            : lastError;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(300);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

// Exported for unit tests - pure text-in, text-out.
export function parseOpeningLines(text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => stripListMarker(l.trim()).trim())
    .filter(Boolean);
  if (lines.length < 3 || lines.length > 5 || !lines.every(isClean)) {
    throw new Error("Opening response was malformed");
  }
  return lines;
}

export async function generateOpening(genre?: string | null): Promise<string[]> {
  const instruction = genre?.trim()
    ? `Write a fresh, original story opening in this genre/theme: ${genre.trim()}.`
    : "Write a fresh, original story opening. Pick any genre.";
  return callDeepSeek(
    "You write vivid, open-ended openings for a collaborative multiplayer story game. " +
      "Respond with ONLY the opening itself: 3-5 sentences, one per line, nothing else - " +
      "no title, no numbering or bullets, no extra commentary. End on a hook that invites " +
      "someone else to continue the story - don't resolve anything.",
    instruction,
    1024,
    parseOpeningLines,
  );
}

// Steers writing quality only - the judge (scoreSentence, below) scores an
// AI turn exactly like a human one, so difficulty never touches the score
// directly. Asking a model to write "at 62/100" isn't reliable; asking it to
// write better or worse prose is.
const DIFFICULTY_INSTRUCTIONS: Record<Difficulty, string> = {
  easy:
    "Write a plain, straightforward continuation. Keep it simple and a little unimaginative - short, " +
    "safe, not particularly creative. This should read as a mediocre turn, giving your opponent a real " +
    "chance to out-write you.",
  normal: "Write a solid, reasonably creative continuation - good but not exceptional, roughly matching a decent human writer's effort.",
  hard:
    "Write a vivid, highly creative, well-crafted continuation. Make it genuinely excellent - strong " +
    "imagery, a real narrative hook, worthy of a top score.",
};

export function parseAiSentence(text: string): string {
  const sentence = stripWrappingQuotes(text.trim());
  if (!sentence || !isClean(sentence)) {
    throw new Error("AI sentence response was malformed");
  }
  return sentence;
}

export async function generateAiSentence(storySoFar: string[], difficulty: Difficulty): Promise<string> {
  return callDeepSeek(
    "You are one player in a collaborative story-writing game. Continue the story with exactly ONE new " +
      "sentence that fits naturally after what's already there - don't resolve the plot, leave room for " +
      "the next writer. Respond with ONLY that one sentence, nothing else - no quotation marks around " +
      `it, no preamble, no labels.\n\n${DIFFICULTY_INSTRUCTIONS[difficulty]}`,
    `STORY SO FAR:\n${storySoFar.join(" ")}\n\nWrite the next sentence.`,
    256,
    parseAiSentence,
  );
}

export type JudgeResult = { score: number; reasoning: string };

export function parseScoreResponse(text: string): JudgeResult {
  const scoreMatch = text.match(/SCORE:\s*(\d{1,3})/i);
  const reasoningMatch = text.match(/REASONING:\s*([\s\S]*)/i);
  const score = scoreMatch ? Number(scoreMatch[1]) : NaN;
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "";
  if (!Number.isFinite(score) || score < 0 || score > 100 || !reasoning || !isClean(reasoning)) {
    throw new Error("Score response was malformed");
  }
  return { score, reasoning };
}

export async function scoreSentence(storySoFar: string[], newSentence: string): Promise<JudgeResult> {
  return callDeepSeek(
    `You judge one turn of a collaborative story-writing elimination game. Score the NEW SENTENCE 0-100 on how well it continues the story, weighing in order of importance:
1. Coherence & continuity - does it make sense given what came before, no contradictions
2. Creativity & interest - does it move the story forward in an engaging way
3. Grammar & writing quality

Score harshly and use the full range: 50 is a mediocre/forgettable sentence, below 50 is weak, confusing, or breaks continuity, above 70 is genuinely good, 90+ is excellent. Players are eliminated when the game's average score drops below 50, so be honest rather than generous.

Respond in EXACTLY this format, nothing else:
SCORE: <a whole number 0-100>
REASONING: <your reasoning, one paragraph>`,
    `STORY SO FAR:\n${storySoFar.join(" ")}\n\nNEW SENTENCE:\n${newSentence}`,
    512,
    parseScoreResponse,
  );
}
