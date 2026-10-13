-- MAP VOTE, server side.
--
-- Each racer's vote is stored on their own player row, and the map for a race is
-- drawn ONCE by the server (first caller wins, every client then reads the same
-- answer). A map is visual only: it is not part of the course fingerprint.

alter table public.race_room_players add column if not exists map_vote text;
alter table public.race_rooms add column if not exists map_key text;
alter table public.race_rooms add column if not exists map_race_id text;

-- The same four keys the client offers (src/world/themes/EnvironmentThemeRegistry.ts).
create or replace function public.race_valid_map_key(p_key text)
returns boolean language sql immutable as $$
  select p_key in ('CITY', 'MIDNIGHT_MOUNTAINS', 'ORBITAL_STATION', 'MIDNIGHT_HARBOUR');
$$;

create or replace function public.race_set_map_vote_v1(p_room_id uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r public.race_rooms;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.race_valid_map_key(p_key) then raise exception 'unknown map'; end if;
  select * into r from public.race_rooms where id = p_room_id;
  if r.id is null then raise exception 'room not found'; end if;
  if r.state <> 'LOBBY' then return; end if;  -- votes are closed once the race is loading
  if not exists (select 1 from public.race_room_players where room_id = p_room_id and user_id = me) then
    raise exception 'not a member of this room';
  end if;
  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players set map_vote = p_key where room_id = p_room_id and user_id = me;
  perform set_config('playhead.authorized_race_write', '0', true);
end;
$$;

-- Returns the map for this race, drawing it on the first call. The draw picks one
-- connected racer's ballot at random (a racer who did not vote counts as p_default).
create or replace function public.race_resolve_map_v1(p_room_id uuid, p_race_id text, p_default text default 'CITY')
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r public.race_rooms;
  d text := case when public.race_valid_map_key(p_default) then p_default else 'CITY' end;
  picked text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into r from public.race_rooms where id = p_room_id for update;
  if r.id is null then raise exception 'room not found'; end if;
  if r.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists (select 1 from public.race_room_players where room_id = p_room_id and user_id = me) then
    raise exception 'not a member of this room';
  end if;
  if r.map_race_id = p_race_id and r.map_key is not null then return r.map_key; end if;

  select coalesce(p.map_vote, d) into picked
    from public.race_room_players p
   where p.room_id = p_room_id and p.connected
   order by random()
   limit 1;
  picked := coalesce(picked, d);

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_rooms set map_key = picked, map_race_id = p_race_id where id = p_room_id;
  perform set_config('playhead.authorized_race_write', '0', true);
  return picked;
end;
$$;

revoke execute on function public.race_set_map_vote_v1(uuid, text) from public, anon;
revoke execute on function public.race_resolve_map_v1(uuid, text, text) from public, anon;
grant execute on function public.race_set_map_vote_v1(uuid, text) to authenticated;
grant execute on function public.race_resolve_map_v1(uuid, text, text) to authenticated;
