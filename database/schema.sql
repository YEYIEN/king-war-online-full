-- Kingdom War: account and match-history schema (Supabase SQL Editor)
-- Do not run until a Supabase project has been created.
-- Google OAuth / anonymous authentication is configured in Supabase Auth separately.
create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '玩家' check (char_length(display_name) between 1 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.match_history (
  id uuid primary key default gen_random_uuid(),
  room_code text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  winner_user_id uuid references auth.users(id) on delete set null,
  outcome_reason text not null,
  players_count smallint not null check (players_count between 1 and 5),
  turns integer not null default 0 check (turns >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.match_participants (
  match_id uuid not null references public.match_history(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  king_name text,
  did_win boolean not null default false,
  was_forfeit boolean not null default false,
  units_deployed integer not null default 0,
  spells_cast integer not null default 0,
  primary key (match_id,user_id)
);
create index if not exists idx_match_participants_user
  on public.match_participants(user_id,match_id);
create table if not exists public.active_matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  state_ciphertext text not null,
  state_version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.active_match_members (
  match_id uuid not null references public.active_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null,
  disconnected_at timestamptz,
  reconnect_deadline timestamptz,
  primary key(match_id,user_id)
);
create index if not exists idx_active_members_user
  on public.active_match_members(user_id);
alter table public.player_profiles enable row level security;
alter table public.match_history enable row level security;
alter table public.match_participants enable row level security;
alter table public.active_matches enable row level security;
alter table public.active_match_members enable row level security;
drop policy if exists profile_select_self on public.player_profiles;
create policy profile_select_self on public.player_profiles
  for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists profile_insert_self on public.player_profiles;
create policy profile_insert_self on public.player_profiles
  for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists profile_update_self on public.player_profiles;
create policy profile_update_self on public.player_profiles
  for update to authenticated using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id);
drop policy if exists participant_select_self on public.match_participants;
create policy participant_select_self on public.match_participants
  for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists match_history_read_own on public.match_history;
create policy match_history_read_own on public.match_history
  for select to authenticated using (
    exists (select 1 from public.match_participants mp
            where mp.match_id=id and mp.user_id=(select auth.uid()))
  );
drop policy if exists match_member_select_self on public.active_match_members;
create policy match_member_select_self on public.active_match_members
  for select to authenticated using ((select auth.uid())=user_id);
-- No client INSERT/UPDATE policies on match history, participants, or live state.
-- Only the game server may write authoritative match data using a server-only role.
-- active_matches contains encrypted game state and must never be exposed directly to clients.
