-- ONLINE RACE MATCHMAKING ("Find Opponent").
--
-- A tiny queue. Players call race_mm_find_v1(mode):
--   * nobody else waiting  -> they join the queue as WAITING;
--   * someone is waiting   -> the caller becomes the HOST of the pair, the waiter
--     becomes the GUEST. The host creates an ordinary race room (so every existing
--     lobby / ready / countdown rule applies unchanged) and publishes its invite
--     code with race_mm_publish_v1; the guest picks it up from race_mm_poll_v1 and
--     joins it. The host chooses the song in the lobby, as in any room.
-- Everything is security definer; the table itself has no client access.

create table if not exists public.race_matchmaking_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'SURF' check (mode in ('SURF', 'NORMAL')),
  status text not null default 'WAITING' check (status in ('WAITING', 'MATCHED')),
  role text check (role in ('HOST', 'GUEST')),
  matched_with uuid,
  matched_at timestamptz,
  invite_code text,
  enqueued_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.race_matchmaking_queue enable row level security;
-- No policies on purpose: clients only reach the queue through the functions below.

create index if not exists race_matchmaking_queue_waiting_idx
  on public.race_matchmaking_queue (mode, enqueued_at) where status = 'WAITING';

create or replace function public.race_mm_find_v1(p_mode text default 'SURF')
returns table (status text, role text, opponent_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  m text := case when upper(coalesce(p_mode, 'SURF')) = 'NORMAL' then 'NORMAL' else 'SURF' end;
  mine public.race_matchmaking_queue;
  opp uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;

  -- Entries nobody is polling any more are gone.
  delete from public.race_matchmaking_queue where last_seen_at < now() - interval '25 seconds';

  select * into mine from public.race_matchmaking_queue where user_id = me;
  if mine.user_id is not null and mine.status = 'MATCHED' then
    return query select mine.status, mine.role, mine.matched_with, mine.invite_code;
    return;
  end if;

  select q.user_id into opp from public.race_matchmaking_queue q
   where q.status = 'WAITING' and q.mode = m and q.user_id <> me
   order by q.enqueued_at
   for update skip locked
   limit 1;

  if opp is not null then
    update public.race_matchmaking_queue
       set status = 'MATCHED', role = 'GUEST', matched_with = me, matched_at = now(),
           invite_code = null, last_seen_at = now()
     where user_id = opp;
    insert into public.race_matchmaking_queue (user_id, mode, status, role, matched_with, matched_at)
    values (me, m, 'MATCHED', 'HOST', opp, now())
    on conflict (user_id) do update
      set mode = excluded.mode, status = 'MATCHED', role = 'HOST', matched_with = opp,
          matched_at = now(), invite_code = null, last_seen_at = now();
    return query select 'MATCHED'::text, 'HOST'::text, opp, null::text;
    return;
  end if;

  insert into public.race_matchmaking_queue (user_id, mode, status)
  values (me, m, 'WAITING')
  on conflict (user_id) do update
    set mode = excluded.mode, status = 'WAITING', role = null, matched_with = null,
        matched_at = null, invite_code = null, last_seen_at = now();
  return query select 'WAITING'::text, null::text, null::uuid, null::text;
end;
$$;

-- Keeps the entry alive and reports it. A GUEST whose host never produced a room
-- goes back to waiting instead of being stuck.
create or replace function public.race_mm_poll_v1()
returns table (status text, role text, opponent_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  mine public.race_matchmaking_queue;
begin
  if me is null then raise exception 'not authenticated'; end if;
  update public.race_matchmaking_queue set last_seen_at = now() where user_id = me;
  select * into mine from public.race_matchmaking_queue where user_id = me;
  if mine.user_id is null then
    return query select 'NONE'::text, null::text, null::uuid, null::text;
    return;
  end if;
  if mine.status = 'MATCHED' and mine.role = 'GUEST' and mine.invite_code is null
     and mine.matched_at < now() - interval '20 seconds' then
    update public.race_matchmaking_queue
       set status = 'WAITING', role = null, matched_with = null, matched_at = null
     where user_id = me;
    return query select 'WAITING'::text, null::text, null::uuid, null::text;
    return;
  end if;
  return query select mine.status, mine.role, mine.matched_with, mine.invite_code;
end;
$$;

-- The host hands its room code to the matched guest.
create or replace function public.race_mm_publish_v1(p_invite_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  mine public.race_matchmaking_queue;
  n int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into mine from public.race_matchmaking_queue where user_id = me;
  if mine.user_id is null or mine.role <> 'HOST' then return false; end if;
  update public.race_matchmaking_queue
     set invite_code = upper(trim(p_invite_code)), last_seen_at = now()
   where user_id = mine.matched_with and matched_with = me and role = 'GUEST';
  get diagnostics n = row_count;
  delete from public.race_matchmaking_queue where user_id = me;
  return n > 0;
end;
$$;

create or replace function public.race_mm_leave_v1()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.race_matchmaking_queue where user_id = auth.uid();
end;
$$;

revoke execute on function public.race_mm_find_v1(text) from public, anon;
revoke execute on function public.race_mm_poll_v1() from public, anon;
revoke execute on function public.race_mm_publish_v1(text) from public, anon;
revoke execute on function public.race_mm_leave_v1() from public, anon;
grant execute on function public.race_mm_find_v1(text) to authenticated;
grant execute on function public.race_mm_poll_v1() to authenticated;
grant execute on function public.race_mm_publish_v1(text) to authenticated;
grant execute on function public.race_mm_leave_v1() to authenticated;
