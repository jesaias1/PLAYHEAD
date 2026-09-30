begin;
create function pg_temp.check_it(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAIL: %',label; end if; end $$;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r uuid := gen_random_uuid();
  verdict jsonb; award text; blocked boolean; phase text; finish public.race_room_players;
begin
  insert into auth.users(id) values(a),(b);
  insert into public.accounts(user_id,username,username_norm)
    values(a,'it_'||left(a::text,8),'it_'||left(a::text,8)),(b,'it_'||left(b::text,8),'it_'||left(b::text,8));
  verdict := public.accept_leaderboard_run(a,'IT_A','__rollback_integrity__',1,'fixture',1000000,'GOLD','fixture','fixture','fixture',null,null,null,1,0);
  perform pg_temp.check_it((verdict->>'is_world_record')::boolean,'first ranked accepted run is WR');
  award := verdict->>'world_record_award_id';
  verdict := public.accept_leaderboard_run(b,'IT_B','__rollback_integrity__',1,'fixture',1200000,'GOLD','fixture','fixture','fixture',null,null,null,1,0);
  perform pg_temp.check_it(not (verdict->>'is_world_record')::boolean,'ordinary slower run is not WR');
  verdict := public.accept_leaderboard_run(b,'IT_B','__rollback_integrity__',1,'fixture',1000000,'GOLD','fixture','fixture','fixture',null,null,null,1,0);
  perform pg_temp.check_it(not (verdict->>'is_world_record')::boolean,'tie is not WR');
  perform set_config('request.jwt.claim.sub',b::text,true);
  blocked := false;
  begin
    execute 'set local role authenticated';
    insert into public.cosmetic_ownership(user_id,cosmetic_id) values(b,'BLACKSTAR');
  exception when others then blocked := true;
  end;
  execute 'reset role';
  perform pg_temp.check_it(blocked,'direct BLACKSTAR grant rejected');
  begin
    execute 'set local role authenticated';
    perform public.sync_progression(p_reward_owned_skin_ids=>array['BLACKSTAR']);
  exception when others then null;
  end;
  execute 'reset role';
  perform pg_temp.check_it(not exists(select 1 from public.cosmetic_ownership where user_id=b and cosmetic_id='BLACKSTAR'),'sync cannot mint BLACKSTAR');
  begin
    execute 'set local role authenticated';
    perform public.grant_progression_events('[{"kind":"own_cosmetic","key":"BLACKSTAR"}]'::jsonb);
  exception when others then null;
  end;
  execute 'reset role';
  perform pg_temp.check_it(not exists(select 1 from public.cosmetic_ownership where user_id=b and cosmetic_id='BLACKSTAR'),'normal event cannot mint BLACKSTAR');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.claim_world_record_award(award);
  perform public.claim_world_record_award(award);
  perform pg_temp.check_it((select count(*)=1 from public.cosmetic_ownership where user_id=a and cosmetic_id='BLACKSTAR'),'WR claim idempotent');
  perform set_config('request.jwt.claim.sub','',true);
  verdict := public.accept_leaderboard_run(b,'IT_B','__rollback_integrity__',1,'fixture',900000,'GOLD','fixture','fixture','fixture',null,null,null,1,0);
  perform pg_temp.check_it((verdict->>'is_world_record')::boolean,'strictly faster run is WR');
  verdict := public.accept_leaderboard_run(b,'IT_B','__rollback_integrity__',1,'fixture',800000,'UNRANKED','fixture','fixture','fixture',null,null,null,1,0);
  perform pg_temp.check_it(not (verdict->>'is_world_record')::boolean,'unranked run is not WR');
  perform pg_temp.check_it(exists(select 1 from public.cosmetic_ownership where user_id=a and cosmetic_id='BLACKSTAR'),'earlier WR ownership survives');
  insert into public.race_rooms(id,invite_code,host_user_id,track_id,map_version,map_fingerprint)
    values(r,left(r::text,8),a,'__rollback_integrity__',1,'fixture');
  insert into public.race_room_players(room_id,user_id) values(r,a),(r,b);
  perform set_config('request.jwt.claim.sub',a::text,true);
  update public.race_room_players set ready=true where room_id=r and user_id=a;
  perform set_config('request.jwt.claim.sub',b::text,true);
  update public.race_room_players set ready=true where room_id=r and user_id=b;
  perform pg_temp.check_it((select state='LOADING' from public.race_rooms where id=r),'lobby readiness triggers loading');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.race_report_loaded(r,true);
  perform pg_temp.check_it((select state='LOADING' from public.race_rooms where id=r),'one loader cannot start countdown');
  blocked := false;
  begin perform public.race_set_in_game_ready(r,true); exception when others then blocked:=true; end;
  perform pg_temp.check_it(blocked,'second ready refused until both loaded');
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform public.race_report_loaded(r,true);
  perform pg_temp.check_it((select state='IN_GAME' from public.race_rooms where id=r),'both loaded only enters waiting');
  perform public.race_set_in_game_ready(r,true);
  perform pg_temp.check_it((select state='IN_GAME' from public.race_rooms where id=r),'one in-game ready cannot start countdown');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.race_set_in_game_ready(r,true);
  perform pg_temp.check_it((select state='COUNTDOWN' and start_at_ms is not null from public.race_rooms where id=r),'both second ready schedule countdown');
  blocked:=false;
  begin update public.race_rooms set state='RUNNING' where id=r; exception when others then blocked:=true; end;
  perform pg_temp.check_it(blocked,'host cannot forge RUNNING');
  perform set_config('playhead.authorized_race_write','1',true);
  update public.race_rooms set start_at_ms=public.race_server_now()-2000 where id=r;
  perform set_config('playhead.authorized_race_write','0',true);
  perform public.race_mark_running(r);
  perform pg_temp.check_it((select state='RUNNING' from public.race_rooms where id=r),'server RUNNING RPC passes guard');
  finish:=public.race_report_finish(r,1);
  perform pg_temp.check_it(finish.session_best_us>=2000000,'finish uses shared epoch, not client time');
  finish:=public.race_report_finish(r,1);
  perform pg_temp.check_it(finish.finish_count=1,'duplicate finish is idempotent');
end $$;
select 'PASS: WR privilege and synchronized race database checks; all fixtures rolled back' as result;
rollback;
