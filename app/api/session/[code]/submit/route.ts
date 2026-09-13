import { NextRequest, NextResponse } from "next/server";
import { submitSentence, GameError } from "@/lib/game";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

// Raise the ceiling above the platform default (10s on Vercel Hobby) since
// this calls DeepSeek - harmless to request even if the plan clamps it lower.
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    // Generous on purpose: this is a same-room party game, so many
    // legitimate players often share one public IP (home wifi/NAT). The
    // "one submit per turn" game logic in submitSentence already bounds
    // real abuse far more tightly than any IP limit could - this is just a
    // backstop.
    if (!(await checkRateLimit("submit", clientIp(req), 60, 300))) {
      return NextResponse.json({ error: "Too many requests - slow down a little." }, { status: 429 });
    }
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
