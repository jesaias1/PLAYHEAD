-- MATCHMAKING v2: each searching player brings the signal they chose.
--
-- When two players are paired, the server picks one of the two choices at random
-- and tells the HOST, who opens the room on that signal. Nobody picks a song while
-- the room loads, and neither player is always favoured.

alter table public.race_matchmaking_queue
  add column if not exists track_id text,
  add column if not exists picked_track_id text;

-- The return type changes, so the old function has to go first.
drop function if exists public.race_mm_find_v1(text);

create or replace function public.race_mm_find_v1(p_mode text default 'SURF', p_track_id text default null)
returns table (status text, role text, opponent_id uuid, invite_code text, picked_track_id text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  m text := case when upper(coalesce(p_mode, 'SURF')) = 'NORMAL' then 'NORMAL' else 'SURF' end;
  t text := left(nullif(trim(coalesce(p_track_id, '')), ''), 120);
  mine public.race_matchmaking_queue;
  opp uuid;
  opp_track text;
  picked text;
begin
  if me is null then raise exception 'not authenticated'; end if;

  delete from public.race_matchmaking_queue where last_seen_at < now() - interval '25 seconds';

  select * into mine from public.race_matchmaking_queue where user_id = me;
  if mine.user_id is not null and mine.status = 'MATCHED' then
    return query select mine.status, mine.role, mine.matched_with, mine.invite_code, mine.picked_track_id;
    return;
  end if;

  select q.user_id, q.track_id into opp, opp_track from public.race_matchmaking_queue q
   where q.status = 'WAITING' and q.mode = m and q.user_id <> me
   order by q.enqueued_at
   for update skip locked
   limit 1;

  if opp is not null then
    picked := case
      when opp_track is null then t
      when t is null then opp_track
      when random() < 0.5 then t
      else opp_track
    end;
    update public.race_matchmaking_queue
       set status = 'MATCHED', role = 'GUEST', matched_with = me, matched_at = now(),
           invite_code = null, picked_track_id = picked, last_seen_at = now()
     where user_id = opp;
    insert into public.race_matchmaking_queue (user_id, mode, status, role, matched_with, matched_at, track_id, picked_track_id)
    values (me, m, 'MATCHED', 'HOST', opp, now(), t, picked)
    on conflict (user_id) do update
      set mode = excluded.mode, status = 'MATCHED', role = 'HOST', matched_with = opp,
          matched_at = now(), invite_code = null, track_id = t, picked_track_id = picked, last_seen_at = now();
    return query select 'MATCHED'::text, 'HOST'::text, opp, null::text, picked;
    return;
  end if;

  insert into public.race_matchmaking_queue (user_id, mode, status, track_id)
  values (me, m, 'WAITING', t)
  on conflict (user_id) do update
    set mode = excluded.mode, status = 'WAITING', role = null, matched_with = null,
        matched_at = null, invite_code = null, track_id = t, picked_track_id = null, last_seen_at = now();
  return query select 'WAITING'::text, null::text, null::uuid, null::text, null::text;
end;
$$;

revoke execute on function public.race_mm_find_v1(text, text) from public, anon;
grant execute on function public.race_mm_find_v1(text, text) to authenticated;
