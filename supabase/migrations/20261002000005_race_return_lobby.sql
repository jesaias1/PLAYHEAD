create or replace function public.race_return_lobby_v2(p_room_id uuid, p_race_id text)
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
  if v_room.expires_at < now() then raise exception 'room expired'; end if;

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
revoke execute on function public.race_return_lobby_v2(uuid,text) from public,anon;
grant execute on function public.race_return_lobby_v2(uuid,text) to authenticated;
