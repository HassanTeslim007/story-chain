import { z } from "zod";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const JUDGE_MODEL = "deepseek-flash";

// Models occasionally derail inside JSON output and append token soup (stray
// braces, mixed scripts) after an otherwise-clean string. Real prose never
// contains curly braces or 40+ char unbroken runs, so this catches it
// cheaply without a second model call to judge the judge.
function isClean(text: string): boolean {
  if (/[{}]/.test(text)) return false;
  if (/\S{40,}/.test(text)) return false;
  return true;
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

// Kept tight on purpose: this runs on Vercel Hobby's default 10s function
// limit. The old code had no per-request timeout at all, so a slow/hanging
// DeepSeek call just ran until the platform itself killed the invocation -
// which returns an empty body, and crashes the client's res.json() with
// "Unexpected end of JSON input" instead of a clean, catchable error. Better
// to time out on our own terms, well inside that ceiling, than let the
// platform do it for us.
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 8000;

async function callDeepSeek<T extends z.ZodType>(
  schema: T,
  schemaName: string,
  system: string,
  user: string,
  maxTokens: number,
  isResultClean: (parsed: z.infer<T>) => boolean = () => true,
): Promise<z.infer<T>> {
  // DeepSeek's JSON mode only supports response_format: {type: "json_object"} -
  // no server-enforced schema like OpenAI/OpenRouter's strict json_schema. So
  // the shape has to be spelled out in the prompt, and the Zod parse below is
  // the only real guarantee of correctness (hence the retry loop).
  const shapeHint =
    `Respond with ONLY a JSON object (no other text) matching this schema, named "${schemaName}":\n` +
    JSON.stringify(z.toJSONSchema(schema));

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
          messages: [
            { role: "system", content: `${system}\n\n${shapeHint}` },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!response.ok) {
        const message = `DeepSeek request failed: ${response.status} ${await response.text()}`;
        throw response.status >= 400 && response.status < 500 ? new NonRetryableError(message) : new Error(message);
      }
      const data = await response.json();
      const parsed = schema.parse(JSON.parse(data.choices[0].message.content));
      if (isResultClean(parsed)) return parsed;
      throw new Error("DeepSeek returned malformed or unclean output");
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

const OpeningSchema = z.object({
  sentences: z.array(z.string()).min(3).max(5),
});

export async function generateOpening(genre?: string | null): Promise<string[]> {
  const instruction = genre?.trim()
    ? `Write a fresh, original story opening in this genre/theme: ${genre.trim()}.`
    : "Write a fresh, original story opening. Pick any genre.";
  const result = await callDeepSeek(
    OpeningSchema,
    "story_opening",
    "You write vivid, open-ended openings for a collaborative multiplayer story game. " +
      "3-5 sentences. End on a hook that invites someone else to continue the story - " +
      "don't resolve anything.",
    instruction,
    1024,
    (parsed) => parsed.sentences.every(isClean),
  );
  return result.sentences;
}

const ScoreSchema = z.object({
  score: z.number().min(0).max(100),
  reasoning: z.string(),
});

export type JudgeResult = z.infer<typeof ScoreSchema>;

export async function scoreSentence(
  storySoFar: string[],
  newSentence: string,
): Promise<JudgeResult> {
  return callDeepSeek(
    ScoreSchema,
    "sentence_score",
    `You judge one turn of a collaborative story-writing elimination game. Score the NEW SENTENCE 0-100 on how well it continues the story, weighing in order of importance:
1. Coherence & continuity - does it make sense given what came before, no contradictions
2. Creativity & interest - does it move the story forward in an engaging way
3. Grammar & writing quality

Score harshly and use the full range: 50 is a mediocre/forgettable sentence, below 50 is weak, confusing, or breaks continuity, above 70 is genuinely good, 90+ is excellent. Players are eliminated when the game's average score drops below 50, so be honest rather than generous.`,
    `STORY SO FAR:\n${storySoFar.join(" ")}\n\nNEW SENTENCE:\n${newSentence}`,
    512,
    (parsed) => isClean(parsed.reasoning),
  );
}
