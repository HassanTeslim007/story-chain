import { createClient } from "@supabase/supabase-js";

// Service-role client for API routes only. Bypasses RLS - never import
// this from a client component.
export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
