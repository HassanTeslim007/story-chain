import { getServiceClient } from "./supabaseServer";

// Fixed-window per-IP rate limiting, backed by a Postgres function
// (increment_rate_limit) so the count is atomic across concurrent
// serverless invocations - an in-memory counter wouldn't survive that on
// Vercel (no shared memory between instances), and a plain
// select-then-update from here would race.
export async function checkRateLimit(routeKey: string, ip: string, limit: number, windowSeconds: number): Promise<boolean> {
  const db = getServiceClient();
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${routeKey}:${ip}:${window}`;
  const { data, error } = await db.rpc("increment_rate_limit", { p_key: key });
  if (error) {
    // Fail open - a rate-limit outage shouldn't take the whole app down.
    console.error("rate limit check failed:", error.message);
    return true;
  }
  return (data as number) <= limit;
}

export function clientIp(req: Request): string {
  // Vercel sets x-forwarded-for; the first entry is the original client.
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
