-- Race guards: membership, exact readiness phases, and invite-only reads.
create or replace function public.race_set_ready_v2(
  p_room_id uuid, p_race_id text, p_ready boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_room  public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid() and connected) then raise exception 'not a connected member of this room'; end if;
  if v_room.state <> 'LOBBY' then raise exception 'ready window is closed'; end if;
  if not exists (
    select 1 from public.race_room_players
    where room_id = p_room_id and user_id = v_user
  ) then raise exception 'not a member of this room'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set ready = coalesce(p_ready, false), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
create or replace function public.race_report_loaded_v2(
  p_room_id uuid, p_race_id text, p_loaded boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_room  public.race_rooms;
  v_row   public.race_room_players;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid() and connected) then raise exception 'not a connected member of this room'; end if;
  if v_room.state not in ('LOADING','IN_GAME') then
    raise exception 'too late to report loaded';
  end if;
  select * into v_row from public.race_room_players
  where room_id = p_room_id and user_id = v_user for update;
  if v_row.user_id is null then raise exception 'not a member of this room'; end if;
  if v_row.dnf then raise exception 'a DNF racer cannot report loaded'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set loaded = coalesce(p_loaded, true), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
create or replace function public.race_set_in_game_ready_v2(
  p_room_id uuid, p_race_id text, p_ready boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_room  public.race_rooms;
  v_row   public.race_room_players;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid() and connected) then raise exception 'not a connected member of this room'; end if;
  if v_room.state <> 'IN_GAME' then
    raise exception 'too late to change in-game ready';
  end if;
  select * into v_row from public.race_room_players
  where room_id = p_room_id and user_id = v_user for update;
  if v_row.user_id is null then raise exception 'not a member of this room'; end if;
  if coalesce(p_ready, false) and not coalesce(v_row.loaded, false) then
    raise exception 'cannot mark in-game ready before reporting loaded';
  end if;
  if v_row.dnf then raise exception 'a DNF racer cannot ready up'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set in_game_ready = coalesce(p_ready, false), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
create or replace function public.race_report_dnf_v2(p_room_id uuid, p_race_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid() and connected) then raise exception 'not a connected member of this room'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set dnf = true, connected = false, last_seen_at = now()
  where room_id = p_room_id and user_id = v_user
    and v_room.state in ('RUNNING','FINISHED')
    and finish_us is null;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
create or replace function public.race_heartbeat_v2(p_room_id uuid, p_race_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.race_rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.race_id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid() and connected) then raise exception 'not a connected member of this room'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  -- Mid-race a heartbeat only refreshes last_seen_at for a LIVE racer; it may
  -- never flip connected back on, nor clear DNF.
  if v_room.state in ('RUNNING','FINISHED') then
    update public.race_room_players
    set last_seen_at = now()
    where room_id = p_room_id and user_id = auth.uid() and connected and not dnf;
  else
    update public.race_room_players
    set last_seen_at = now()
    where room_id = p_room_id and user_id = auth.uid() and not dnf;
  end if;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
create or replace function public.race_mark_disconnected_v2(p_room_id uuid, p_race_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid() and connected) then raise exception 'not a connected member of this room'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false,
      ready = false, loaded = false, in_game_ready = false,
      dnf = (dnf or (v_room.state = 'RUNNING' and finish_us is null)),
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
  if v_room.state in ('LOBBY','LOADING','IN_GAME','COUNTDOWN') then delete from public.race_room_players where room_id=p_room_id and user_id=v_user; end if;
  perform public.race_cancel_staging(p_room_id, v_room.state);
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_maybe_migrate_host(p_room_id);
  perform public.race_room_advance(p_room_id);
end;
$$;
create or replace function public.race_abandon_session_v2(
  p_room_id uuid, p_race_id text, p_reason text default 'ABORTED'
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid() and connected) then raise exception 'not a connected member of this room'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false, ready = false, loaded = false, in_game_ready = false,
      dnf = (dnf or (v_room.state = 'RUNNING' and finish_us is null)),
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user and finish_us is null;

  -- Before the race is live, return the room to LOBBY so the survivors are never
  -- stranded in a dead countdown. While RUNNING the room keeps going.
  if v_room.state in ('LOADING','IN_GAME','COUNTDOWN') then
    update public.race_rooms
    set state = 'LOBBY', start_at_ms = null, started_at = null
    where id = p_room_id;
  end if;
  perform set_config('playhead.authorized_race_write', '0', true);

  perform public.race_maybe_migrate_host(p_room_id);
  perform public.race_room_advance(p_room_id);
end;
$$;
create or replace function public.race_request_rematch_v2(p_room_id uuid, p_race_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_room      public.race_rooms;
  v_connected int;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid() and connected) then raise exception 'not a connected member of this room'; end if;
  if v_room.host_user_id <> auth.uid() then raise exception 'host only'; end if;
  if v_room.state <> 'FINISHED' then raise exception 'race is not finished'; end if;
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) then raise exception 'not a member of this room'; end if;

  select count(*) into v_connected
  from public.race_room_players where room_id = p_room_id and connected;
  if v_connected < 2 then raise exception 'not enough players to rematch'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  delete from public.race_room_players
  where room_id = p_room_id and (not connected or dnf);

  update public.race_room_players
  set ready = false,
      loaded = false,
      in_game_ready = false,
      finish_us = null,
      finished = false,
      dnf = false,
      progress = 0,
      checkpoint_total = 0,
      last_seen_at = now()
  where room_id = p_room_id;

  -- NEW RACE INSTANCE FIRST: every stale packet/write aimed at the old race_id
  -- is rejected the moment this commits.
  update public.race_rooms
  set state = 'LOBBY',
      start_at_ms = null,
      started_at = null,
      finished_at = null,
      race_id = 'race-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  where id = p_room_id;

  perform set_config('playhead.authorized_race_write', '0', true);
end;
$$;
create or replace function public.race_report_finish_v2(
  p_room_id uuid, p_race_id text, p_progress integer default null
)
returns public.race_room_players
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_room      public.race_rooms;
  v_row       public.race_room_players;
  v_epoch_us  bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  -- ROOM FIRST, then PLAYER: consistent lock order across every v2 function.
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;


  v_epoch_us := ((extract(epoch from now()) * 1000)::bigint - v_room.start_at_ms) * 1000;
  if v_epoch_us <= 0 then raise exception 'race timeline has not started'; end if;

  select * into v_row from public.race_room_players
  where room_id = p_room_id and user_id = v_user for update;
  if v_row.user_id is null then raise exception 'not a member of this room'; end if;
  if v_row.finish_us is not null then return v_row; end if;
  if v_room.state <> 'RUNNING' or v_room.start_at_ms is null then
    raise exception 'no authoritative running timeline to report against';
  end if;
  if v_row.dnf or not v_row.connected then
    raise exception 'a disconnected or DNF racer cannot finish';
  end if;
  -- IMMUTABLE + IDEMPOTENT: once frozen, a finish time never changes and a
  -- duplicate packet is dropped entirely.
  if v_row.finish_us is not null then return v_row; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set finish_us = v_epoch_us,
      finished = true,
      connected = true,
      progress = greatest(progress, coalesce(p_progress, progress)),
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user
  returning * into v_row;
  perform set_config('playhead.authorized_race_write', '0', true);

  perform public.race_room_advance(p_room_id);
  return v_row;
end;
$$;
create or replace function public.race_rooms_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if current_setting('playhead.authorized_race_write', true) = '1' then
    if new.state is distinct from old.state then new.phase_changed_at := clock_timestamp(); end if;
    return new;
  end if;
  if auth.uid() is null then return new; end if;   -- service-role context

  if tg_op='INSERT' then
    if new.state <> 'LOBBY' or new.start_at_ms is not null or new.started_at is not null or new.finished_at is not null then raise exception 'new room must start in LOBBY'; end if;
    new.race_id := 'race-' || replace(gen_random_uuid()::text,'-','');
    return new;
  end if;
  raise exception 'race state is server-authoritative; use the race RPCs';
  if new.start_at_ms is distinct from old.start_at_ms then
    raise exception 'start_at_ms is server-authoritative';
  end if;
  if new.race_id is distinct from old.race_id then
    raise exception 'race_id is server-authoritative';
  end if;
  -- Clock + lifecycle fields are also server-owned for direct writers.
  if new.started_at is distinct from old.started_at
     or new.finished_at is distinct from old.finished_at then
    raise exception 'race clock is server-authoritative';
  end if;
  -- SETUP LOCK: track/title/identity/capacity may only change from LOBBY.
  if new.track_id is distinct from old.track_id
     or new.track_title is distinct from old.track_title
     or new.map_version is distinct from old.map_version
     or new.map_fingerprint is distinct from old.map_fingerprint
     or new.capacity is distinct from old.capacity then
    if old.state <> 'LOBBY' then
      raise exception 'race setup is locked after the lobby';
    end if;
  end if;
  -- STATE IS SERVER-AUTHORITATIVE, FULL STOP. A host may NOT flip a room to
  -- FINISHED/LOBBY directly: every phase change goes through race_room_advance
  -- / rematch / abandon with the authorized-write flag set.
  if new.state is distinct from old.state then
    raise exception 'race state is server-authoritative';
  end if;
  if new.host_user_id is distinct from old.host_user_id
     or new.invite_code is distinct from old.invite_code then
    raise exception 'room identity is immutable';
  end if;

  return new;
end;
$$;
create or replace function public.race_is_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid());
$$;
revoke execute on function public.race_is_member(uuid) from public,anon;
grant execute on function public.race_is_member(uuid) to authenticated;
drop policy if exists race_rooms_read_all on public.race_rooms;
create policy race_rooms_read_members on public.race_rooms for select to authenticated
using (host_user_id=auth.uid() or public.race_is_member(id));
drop policy if exists race_players_read_all on public.race_room_players;
create policy race_players_read_members on public.race_room_players for select to authenticated
using (public.race_is_member(room_id));
create or replace function public.race_find_room_v2(p_invite_code text)
returns public.race_rooms language plpgsql security definer set search_path=public as $$
declare r public.race_rooms;
begin
 if auth.uid() is null then raise exception 'not authenticated'; end if;
 select * into r from public.race_rooms where invite_code=upper(trim(p_invite_code));
 if r.id is null then raise exception 'room not found'; end if;
 if r.expires_at<now() or r.state='EXPIRED' then raise exception 'room expired'; end if;
 return r;
end;
$$;
revoke execute on function public.race_find_room_v2(text) from public,anon;
grant execute on function public.race_find_room_v2(text) to authenticated;
