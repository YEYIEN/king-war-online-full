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
  // Avoid .single() after an ignored upsert: PostgreSQL may return zero rows
  // when a concurrent request already inserted the profile.
  const inserted = await supabase.from("player_profiles")
    .insert({ user_id:user.id, display_name:preferred });
  if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
  const { data: saved, error: readError } = await supabase.from("player_profiles")
    .select("user_id,display_name,created_at")
    .eq("user_id",user.id).maybeSingle();
  if (readError) throw readError;
  if (!saved) throw new Error("玩家資料尚未建立，請重新登入再試。");
  return saved;
}
