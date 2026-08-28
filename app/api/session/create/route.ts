import { NextRequest, NextResponse } from "next/server";
import { createSession, GameError } from "@/lib/game";
import type { SessionMode } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const { hostName, turnSeconds, mode, maxTurnsPerPlayer } = await req.json();
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
    );
    return NextResponse.json({ session, player });
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
