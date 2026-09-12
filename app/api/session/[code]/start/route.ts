import { NextRequest, NextResponse } from "next/server";
import { startGame, GameError } from "@/lib/game";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

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
