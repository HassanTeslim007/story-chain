"use client";

import { useCallback, useEffect, useState } from "react";

// turn_deadline is an absolute timestamp set by the server. Comparing it
// against a client's raw Date.now() silently assumes the two clocks agree -
// a client whose system clock runs behind real time sees phantom extra
// seconds on the countdown, submits believing it's in time, and gets a
// genuine "Turn already expired" from the server's own (correct) check.
// This estimates client-minus-server skew once and periodically after, the
// same midpoint approximation NTP uses: assume the request and response
// legs of the round trip took equally long, so the server's clock read
// `serverNow` at roughly the midpoint between when the request left and the
// response arrived.
export function useServerClockOffset() {
  const [offset, setOffset] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const t0 = Date.now();
      const res = await fetch("/api/time");
      const { now: serverNow } = await res.json();
      const t1 = Date.now();
      const estimatedServerNowAtT1 = serverNow + (t1 - t0) / 2;
      setOffset(estimatedServerNowAtT1 - t1);
    } catch {
      // Leave the previous estimate in place - stale is better than
      // clobbering a good offset with zero on a transient network blip.
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { offset, refresh };
}
