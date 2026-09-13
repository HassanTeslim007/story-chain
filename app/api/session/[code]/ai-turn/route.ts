import { NextRequest, NextResponse } from "next/server";
import { resolveAiTurn, GameError } from "@/lib/game";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

// Two chained DeepSeek calls happen here (the AI writes, then the judge
// scores it via submitSentence) - double the headroom /submit and /start get.
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    if (!(await checkRateLimit("ai-turn", clientIp(req), 40, 600))) {
      return NextResponse.json({ error: "Too many requests - slow down a little." }, { status: 429 });
    }
    const { code } = await params;
    const result = await resolveAiTurn(code);
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
