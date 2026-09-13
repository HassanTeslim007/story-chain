import { NextRequest, NextResponse } from "next/server";
import { startGame, GameError } from "@/lib/game";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

// Raise the ceiling above the platform default (10s on Vercel Hobby) since
// this calls DeepSeek - harmless to request even if the plan clamps it lower.
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    // The real DeepSeek cost/abuse vector is here (the opening generation),
    // not /create - createSession itself never calls the model.
    if (!(await checkRateLimit("start", clientIp(req), 15, 600))) {
      return NextResponse.json({ error: "Too many games started - try again in a few minutes." }, { status: 429 });
    }
    const { code } = await params;
    await startGame(code);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
