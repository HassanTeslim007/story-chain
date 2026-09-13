import { NextRequest, NextResponse } from "next/server";
import { createSoloGame, GameError } from "@/lib/game";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

// Same reasoning as /start: this triggers the opening-generation DeepSeek
// call, so it needs the same headroom above the platform default.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    if (!(await checkRateLimit("solo", clientIp(req), 15, 600))) {
      return NextResponse.json({ error: "Too many games started - try again in a few minutes." }, { status: 429 });
    }
    const { hostName, turnSeconds, maxTurnsPerPlayer, genre, difficulty } = await req.json();
    if (!hostName || typeof hostName !== "string") {
      return NextResponse.json({ error: "hostName is required" }, { status: 400 });
    }
    const seconds = Number(turnSeconds) || 30;
    const { session, player } = await createSoloGame(
      hostName,
      seconds,
      Number(maxTurnsPerPlayer) || undefined,
      typeof genre === "string" ? genre : undefined,
      typeof difficulty === "string" ? difficulty : undefined,
    );
    return NextResponse.json({ session, player });
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
