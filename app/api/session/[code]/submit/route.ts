import { NextRequest, NextResponse } from "next/server";
import { submitSentence, GameError } from "@/lib/game";

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const { playerId, content } = await req.json();
    if (!playerId || typeof content !== "string") {
      return NextResponse.json({ error: "playerId and content are required" }, { status: 400 });
    }
    const result = await submitSentence(code, playerId, content);
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
