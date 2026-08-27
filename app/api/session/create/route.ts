import { NextRequest, NextResponse } from "next/server";
import { createSession, GameError } from "@/lib/game";

export async function POST(req: NextRequest) {
  try {
    const { hostName, turnSeconds } = await req.json();
    if (!hostName || typeof hostName !== "string") {
      return NextResponse.json({ error: "hostName is required" }, { status: 400 });
    }
    const seconds = Number(turnSeconds) || 30;
    const { session, player } = await createSession(hostName, seconds);
    return NextResponse.json({ session, player });
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
