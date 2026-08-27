import { NextRequest, NextResponse } from "next/server";
import { startGame, GameError } from "@/lib/game";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    await startGame(code);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
