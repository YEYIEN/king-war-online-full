import { createClient } from "@supabase/supabase-js";

// Publishable key is intentionally public; never put a service_role or OAuth secret here.
export const supabase = createClient(
  "https://xhtkcuuaqgihlduasnqn.supabase.co",
  "sb_publishable_Lyswu178G_8pY9G4ACfPDA_Du7ZKvth",
  { auth: { flowType: "pkce", detectSessionInUrl: true, autoRefreshToken: true, persistSession: true } }
);
export async function loadAccount() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error && !/session missing|auth session missing/i.test(error.message)) throw error;
  return user || null;
}
export async function ensurePlayerProfile(user, displayName) {
  if (!user || user.is_anonymous) return null;
  const { data, error } = await supabase.from("player_profiles")
    .select("user_id,display_name,created_at")
    .eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const preferred = String(displayName || user.user_metadata?.full_name || user.email?.split("@")[0] || "玩家").slice(0,32).trim() || "玩家";
  const inserted = await supabase.from("player_profiles")
    .upsert({ user_id:user.id, display_name:preferred }, { onConflict:"user_id", ignoreDuplicates:true })
    .select("user_id,display_name,created_at").single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}
