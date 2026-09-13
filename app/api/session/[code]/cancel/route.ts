import { NextRequest, NextResponse } from "next/server";
import { cancelSession, GameError } from "@/lib/game";

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const { playerId } = await req.json();
    if (!playerId) {
      return NextResponse.json({ error: "playerId is required" }, { status: 400 });
    }
    await cancelSession(code, playerId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
