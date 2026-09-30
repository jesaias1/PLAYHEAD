-- =============================================================================
-- ACCOUNTS — no-email username + password identity
-- =============================================================================
--
-- WHY
--
-- The player must be able to create a durable account with a USERNAME and a
-- PASSWORD and no email address. Anonymous Supabase sessions are device-bound
-- and can be lost when browser storage is cleared, which is unacceptable for a
-- competitive leaderboard.
--
-- DESIGN
--
-- Passwords are hashed and verified by Supabase Auth itself (GoTrue, bcrypt):
-- a username maps 1:1 to a deterministic internal address
-- `<username_norm>@players.playhead.local`. The player NEVER sees, provides or
-- needs that address — it is an implementation detail that lets GoTrue own the
-- password hashing, the session and the JWT. The stable identity remains
-- `auth.users.id`, exactly as before, so every existing progression, PB, replay
-- and RLS policy keeps working untouched.
--
-- This table stores ONLY the username uniqueness constraint and the stable
-- username -> user_id mapping. It NEVER stores a password or a password hash
-- (that lives in auth.users.encrypted_password, managed by GoTrue).
--
-- RLS: enabled with NO client policy. The row is written only by the
-- `account-auth` Edge Function (service role) and read through a narrow
-- SECURITY DEFINER lookup whose only output is "taken / not taken".
--
-- Apply with:  npx supabase db push
-- =============================================================================

create table if not exists public.accounts (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  username       text not null,
  username_norm  text not null unique,
  created_at     timestamptz not null default now()
);

alter table public.accounts enable row level security;
-- Deliberately NO policies: a browser can neither read nor write this table.

create index if not exists accounts_norm_idx on public.accounts (username_norm);

-- -----------------------------------------------------------------------------
-- Username availability. Returns ONLY a boolean — never the row, never a user id,
-- so it cannot be used to enumerate accounts beyond taken/free.
-- -----------------------------------------------------------------------------
create or replace function public.account_username_taken(p_username_norm text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.accounts where username_norm = lower(coalesce(p_username_norm, ''))
  );
$$;

grant execute on function public.account_username_taken(text) to anon, authenticated;
