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

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
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
      throw new Error(`DeepSeek request failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    const content = data.choices[0].message.content;
    const parsed = schema.parse(JSON.parse(content));
    if (isResultClean(parsed)) return parsed;
  }
  throw new Error("DeepSeek returned malformed output twice in a row");
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
