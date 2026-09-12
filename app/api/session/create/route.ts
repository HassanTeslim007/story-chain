import { NextRequest, NextResponse } from "next/server";
import { createSession, GameError } from "@/lib/game";
import type { SessionMode } from "@/lib/types";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  try {
    if (!(await checkRateLimit("create", clientIp(req), 8, 600))) {
      return NextResponse.json({ error: "Too many games created - try again in a few minutes." }, { status: 429 });
    }
    const { hostName, turnSeconds, mode, maxTurnsPerPlayer, genre } = await req.json();
    if (!hostName || typeof hostName !== "string") {
      return NextResponse.json({ error: "hostName is required" }, { status: 400 });
    }
    const seconds = Number(turnSeconds) || 30;
    const resolvedMode: SessionMode = mode === "marathon" ? "marathon" : "elimination";
    const { session, player } = await createSession(
      hostName,
      seconds,
      resolvedMode,
      Number(maxTurnsPerPlayer) || undefined,
      typeof genre === "string" ? genre : undefined,
    );
    return NextResponse.json({ session, player });
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
