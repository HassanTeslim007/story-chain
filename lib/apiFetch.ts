// A gateway timeout (platform infra killing a slow request) or a dropped
// connection returns an empty/non-JSON body - calling res.json() directly on
// that throws "Unexpected end of JSON input" and crashes the caller instead
// of showing a message. This wraps every API call so a broken response
// always turns into a normal { error } the caller can just display.
export async function postJson<T = unknown>(
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; data: T & { error?: string } }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, data: { error: "Network error - check your connection and try again." } as T & { error: string } };
  }

  try {
    const data = await res.json();
    return { ok: res.ok, data };
  } catch {
    const message =
      res.status === 504
        ? "The judge took too long to respond - try again."
        : "Something went wrong. Please try again.";
    return { ok: false, data: { error: message } as T & { error: string } };
  }
}
