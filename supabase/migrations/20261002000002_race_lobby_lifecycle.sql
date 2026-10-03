-- Race lifecycle follow-up: lobby removal and atomic host setup changes.
create or replace function public.race_compute_color_index(p_room_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_candidate int;
begin
  for v_candidate in 0..7 loop
    if not exists (
      select 1 from public.race_room_players p
      where p.room_id = p_room_id and p.connected and p.color_index = v_candidate
    ) then
      return v_candidate;
    end if;
  end loop;
  return (select count(*)::int % 8 from public.race_room_players where room_id = p_room_id);
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

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false,
      ready = false, loaded = false, in_game_ready = false,
      dnf = (dnf or (v_room.state = 'RUNNING' and finish_us is null)),
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
  if v_room.state='LOBBY' then delete from public.race_room_players where room_id=p_room_id and user_id=v_user; end if;
  perform public.race_cancel_staging(p_room_id, v_room.state);
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_maybe_migrate_host(p_room_id);
  perform public.race_room_advance(p_room_id);
end;
$$;
create or replace function public.race_select_track_v2(
  p_room_id uuid, p_race_id text, p_track_id text, p_track_title text,
  p_map_version integer, p_map_fingerprint text
) returns void language plpgsql security definer set search_path=public as $$
declare r public.race_rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into r from public.race_rooms where id=p_room_id for update;
  if r.id is null then raise exception 'room not found'; end if;
  if r.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if r.host_user_id <> auth.uid() or r.state <> 'LOBBY' then raise exception 'only the lobby host can choose the track'; end if;
  if not exists(select 1 from public.race_room_players where room_id=p_room_id and user_id=auth.uid() and connected) then raise exception 'not connected'; end if;
  if p_track_id is null or p_map_fingerprint is null or p_map_version is null then raise exception 'missing map identity'; end if;
  perform set_config('playhead.authorized_race_write','1',true);
  update public.race_rooms set track_id=p_track_id,track_title=p_track_title,map_version=p_map_version,map_fingerprint=p_map_fingerprint where id=p_room_id;
  update public.race_room_players set ready=false,loaded=false,in_game_ready=false where room_id=p_room_id;
  perform set_config('playhead.authorized_race_write','0',true);
end;
$$;
revoke execute on function public.race_select_track_v2(uuid,text,text,text,integer,text) from public,anon;
grant execute on function public.race_select_track_v2(uuid,text,text,text,integer,text) to authenticated;
