"use client";

import { useEffect, useState } from "react";

// No accounts, no server-side user data - "have they seen this" is a plain
// per-browser localStorage flag, same mechanism as the theme picker. Powers
// two things with one piece of state: auto-opens once per browser on first
// visit to this page, and reopens on demand via the "?" button forever
// after - dismissing never removes the ability to look it up again.
export function useFirstVisitHelp(key: string) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(key)) setOpen(true);
    } catch {
      // Private browsing / storage disabled - just don't auto-show; the
      // "?" button still works regardless.
    }
  }, [key]);

  function dismiss() {
    setOpen(false);
    try {
      localStorage.setItem(key, "1");
    } catch {}
  }

  function reopen() {
    setOpen(true);
  }

  return { open, dismiss, reopen };
}
