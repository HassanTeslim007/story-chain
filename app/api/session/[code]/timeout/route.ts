import { NextRequest, NextResponse } from "next/server";
import { checkTimeout, GameError } from "@/lib/game";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const result = await checkTimeout(code);
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof GameError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
