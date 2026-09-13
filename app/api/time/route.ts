import { NextResponse } from "next/server";

// Lets the client correct for its own clock skew against the server's -
// turn_deadline is an absolute server timestamp, so a client whose system
// clock runs behind real time would otherwise see phantom extra seconds on
// the countdown and get a genuine "Turn already expired" on a submit it
// believed was well within time.
export async function GET() {
  return NextResponse.json({ now: Date.now() });
}
