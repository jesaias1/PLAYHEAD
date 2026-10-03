create or replace function public.race_join_room(
  p_room_id uuid,
  p_display_name text,
  p_loadout jsonb default '{}'::jsonb
)
returns public.race_room_players
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
  v_connected int;
  v_existing boolean;
  v_row public.race_room_players;
  v_name text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  -- The row lock makes the capacity check and the insert ONE atomic decision.
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.expires_at < now() then raise exception 'room expired'; end if;

  select exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) into v_existing;

  if v_room.state <> 'LOBBY' then raise exception 'race already in progress'; end if;
  if not v_existing or not exists (select 1 from public.race_room_players where room_id=p_room_id and user_id=v_user and connected) then
    -- JOIN ONLY BEFORE LOCK. No silent mid-race entry.
    if v_room.state <> 'LOBBY' then
      raise exception 'race already in progress';
    end if;
    select count(*) into v_connected
    from public.race_room_players
    where room_id = p_room_id and connected;
    if v_connected >= v_room.capacity then
      raise exception 'room is full';
    end if;
  end if;

  v_name := (select nullif(btrim(display_name), '') from public.profiles where id = v_user);
  if v_name is null then v_name := 'PLAYER'; end if;
  v_name := left(v_name, 24);

  perform set_config('playhead.authorized_race_write', '1', true);

  if v_existing then
    update public.race_room_players
    set connected = true, ready=false, loaded=false, in_game_ready=false, dnf=false, last_seen_at = now()
    where room_id = p_room_id and user_id = v_user
    returning * into v_row;
  else
    insert into public.race_room_players (
      room_id, user_id, display_name, loadout, ready, connected, color_index, last_seen_at
    ) values (
      p_room_id, v_user, v_name, public.race_player_loadout(v_user), false, true,
      public.race_compute_color_index(p_room_id), now()
    )
    returning * into v_row;
  end if;

  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
  return v_row;
end;
$$;

