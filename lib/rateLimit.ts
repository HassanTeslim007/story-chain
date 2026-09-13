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
  try {
    // A hung Supabase RPC (not just an error - a slow response that
    // eventually errors or never resolves) eats straight into the same
    // per-invocation time budget the judge call is racing against, which
    // can push a whole request past the platform's own function timeout
    // even though this fails open on outright errors. Bound it explicitly
    // so a rate-limit hiccup can never be the thing that gateway-times-out
    // an otherwise-healthy submit.
    const { data, error } = await db
      .rpc("increment_rate_limit", { p_key: key })
      .abortSignal(AbortSignal.timeout(3000));
    if (error) {
      console.error("rate limit check failed:", error.message);
      return true; // Fail open - a rate-limit outage shouldn't take the whole app down.
    }
    return (data as number) <= limit;
  } catch (err) {
    console.error("rate limit check failed:", err instanceof Error ? err.message : err);
    return true;
  }
}

export function clientIp(req: Request): string {
  // Vercel sets x-forwarded-for; the first entry is the original client.
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
