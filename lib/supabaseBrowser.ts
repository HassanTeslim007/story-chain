import { createClient } from "@supabase/supabase-js";

// Anon-key client for browser use. RLS policies only allow public
// SELECT on sessions/players/sentences - all writes go through API routes.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
