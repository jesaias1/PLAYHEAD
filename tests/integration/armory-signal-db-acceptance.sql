-- =============================================================================
-- ARMORY SIGNAL DROPS — DB ACCEPTANCE (transactional; BEGIN ... ROLLBACK)
-- =============================================================================
-- Covers the ACTUAL SQL functions deployed by
--   supabase/migrations/20261001000000_armory_signal_drops.sql
--
--   * first DIAMOND awards one drop (repeat / lower rank / custom audio do not)
--   * no drop for an unregistered account
--   * unowned winner => owned; same id open is idempotent and never rerolls
--   * knife exhaustion falls through to gloves; both complete => no useless drop
--   * BLACKSTAR is excluded from the pool
--   * auth cross-account denial (a client cannot open/read another account)
--   * direct INSERT + generic grant_progression_events / sync ownership bypass
--     for a Signal Drop id is DENIED, while legitimate owned / equipment saves
--     and WR-reserved behaviour are PRESERVED
--   * historical :DIAMOND ledger INCLUDING already-SPENT keys (sentinel-gated)
--
-- Fixtures only ever run inside this ROLLBACK, so no ranked/cosmetic data is
-- persisted. Combined legacy dry-run order:
--   tests/integration/armory-signal-legacy-seed.sql  (BEFORE the migration)
--   -> supabase/migrations/20261001000000_armory_signal_drops.sql
--   -> THIS file (asserts the legacy conversion because the sentinel exists)
-- =============================================================================
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if not coalesce(cond,false) then raise exception 'FAIL: %', label; end if; end $$;

do $$
declare
  a uuid := 'a0000000-0000-4000-8000-0000000000a0';
  b uuid := 'b0000000-0000-4000-8000-0000000000b0';
  c uuid := 'c0000000-0000-4000-8000-0000000000c0';   -- legitimate owned/equipment
  d uuid := 'd0000000-0000-4000-8000-0000000000d0';
  e uuid := 'e0000000-0000-4000-8000-0000000000e0';
  f uuid := 'f0000000-0000-4000-8000-0000000000f0';   -- unregistered
  t1 text := 'track_01_signal_drift';
  t2 text := 'track_02_signal_drift';
  v jsonb;
  prog public.player_progress;
  drop1 uuid; drop3 uuid; drop_id text; probe uuid;
  kind_txt text;
  blocked boolean;
  ledger jsonb;
begin
  insert into auth.users(id) values (a),(b),(c),(d),(e),(f);
  insert into public.accounts(user_id,username,username_norm)
    values (a,'it_a','it_a'),(b,'it_b','it_b'),(c,'it_c','it_c'),
           (d,'it_d','it_d'),(e,'it_e','it_e');

  -- -----------------------------------------------------------------------
  -- 1. FIRST DIAMOND awards ONE drop; repeat / lower / custom / no-reset do NOT
  -- -----------------------------------------------------------------------
  v := public.accept_leaderboard_run(a,'A',t1,1,'fp1',1000000,'BRONZE','m','g','b',null,null,null,1,0);
  perform pg_temp.ok(v->>'signal_drop_id' is null, 'BRONZE does not award a drop');
  v := public.accept_leaderboard_run(a,'A',t1,1,'fp1',900000,'SILVER','m','g','b',null,null,null,1,0);
  perform pg_temp.ok(v->>'signal_drop_id' is null, 'SILVER does not award a drop');
  v := public.accept_leaderboard_run(a,'A',t1,1,'fp1',800000,'GOLD','m','g','b',null,null,null,1,0);
  perform pg_temp.ok(v->>'signal_drop_id' is null, 'GOLD does not award a drop');
  v := public.accept_leaderboard_run(a,'A',t1,1,'fp1',700000,'DIAMOND','m','g','b',null,null,null,1,0);
  drop1 := (v->>'signal_drop_id')::uuid;
  perform pg_temp.ok(drop1 is not null, 'first DIAMOND awards a drop');
  perform pg_temp.ok(exists(select 1 from public.awarded_diamond_drop_tracks where user_id=a and track_id=t1),
    'first DIAMOND records the (account,track) ledger');
  v := public.accept_leaderboard_run(a,'A',t1,1,'fp1',690000,'DIAMOND','m','g','b',null,null,null,1,0);
  perform pg_temp.ok(v->>'signal_drop_id' is null, 'repeat DIAMOND awards nothing');
  perform pg_temp.ok((select count(*)=1 from public.signal_drops where user_id=a and track_id=t1),
    'repeat DIAMOND creates no second drop row');
  v := public.accept_leaderboard_run(a,'A',t1,1,'fp1',680000,'DIAMOND','m','g','b',null,null,null,1,1);
  perform pg_temp.ok(v->>'signal_drop_id' is null, 'DIAMOND with resets awards nothing');
  v := public.accept_leaderboard_run(a,'A','custom-upload.wav',1,'fp1',600000,'DIAMOND','m','g','b',null,null,null,0,0);
  perform pg_temp.ok(v->>'signal_drop_id' is null, 'custom audio awards nothing');

  v := public.accept_leaderboard_run(f,'F',t1,1,'fp1',1000000,'DIAMOND','m','g','b',null,null,null,1,0);
  perform pg_temp.ok(v->>'signal_drop_id' is null, 'unregistered account awards nothing');
  perform pg_temp.ok(not exists(select 1 from public.signal_drops where user_id=f), 'no drop row for unregistered');

  -- -----------------------------------------------------------------------
  -- 2. OPEN: unowned winner => owned; idempotent replay; never rerolls
  -- -----------------------------------------------------------------------
  perform pg_temp.ok((select count(*) from public.signal_drop_pool(a)) > 0,
    'eligible pool is non-empty for a fresh account');
  perform pg_temp.ok(not exists(
      select 1 from public.signal_drop_pool(a) p where not public.is_signal_drop_cosmetic(p.cosmetic_id)
    ), 'every pool entry is a Signal Drop cosmetic');

  perform set_config('request.jwt.claim.sub', a::text, true);
  select d.cosmetic_id into drop_id from public.open_signal_drop(drop1) d;
  perform pg_temp.ok(drop_id is not null, 'open resolves a server-side winner');
  perform pg_temp.ok(exists(select 1 from public.cosmetic_ownership o where o.user_id=a and o.cosmetic_id=drop_id),
    'winner becomes owned');
  perform pg_temp.ok((select status='opened' from public.signal_drops where id=drop1), 'drop marked opened');
  perform pg_temp.ok((select count(*)=1 from public.signal_drop_open_events e where e.drop_id=drop1),
    'exactly one open event recorded');

  select d.cosmetic_id into drop_id from public.open_signal_drop(drop1) d;
  perform pg_temp.ok((select count(*)=1 from public.signal_drop_open_events e where e.drop_id=drop1),
    'idempotent replay does not reroll or duplicate the event');

  -- -----------------------------------------------------------------------
  -- 3. KNIFE exhaustion => glove; both complete => no useless drop
  -- -----------------------------------------------------------------------
  perform set_config('playhead.authorized_cosmetic_write','1',true);
  insert into public.cosmetic_ownership(user_id, cosmetic_id, unlock_source)
  select a, p.cosmetic_id, 'TEST' from public.signal_drop_pool(a) p
  where p.category='KNIFE' on conflict do nothing;
  perform set_config('playhead.authorized_cosmetic_write','0',true);
  perform pg_temp.ok((select count(*) from public.signal_drop_pool(a) where category='GLOVE') > 0,
    'glove pool still has entries after knives own');

  perform set_config('playhead.authorized_drop_write','1',true);
  insert into public.signal_drops(user_id,track_id,track_key,rarity,status)
    values(a,'legacy:glove_probe','legacy:glove_probe','STANDARD','unopened') returning id into probe;
  perform set_config('playhead.authorized_drop_write','0',true);
  select d.kind into kind_txt from public.open_signal_drop(probe) d;
  perform pg_temp.ok(kind_txt = 'GLOVE', 'knife exhaustion falls through to a glove');

  perform set_config('playhead.authorized_cosmetic_write','1',true);
  insert into public.cosmetic_ownership(user_id, cosmetic_id, unlock_source)
  select a, p.cosmetic_id, 'TEST' from public.signal_drop_pool(a) p on conflict do nothing;
  perform set_config('playhead.authorized_cosmetic_write','0',true);
  perform pg_temp.ok((select count(*) from public.signal_drop_pool(a)) = 0, 'pool fully exhausted');
  perform set_config('playhead.authorized_drop_write','1',true);
  insert into public.signal_drops(user_id,track_id,track_key,rarity,status)
    values(a,'legacy:spent_probe','legacy:spent_probe','STANDARD','unopened') returning id into probe;
  perform set_config('playhead.authorized_drop_write','0',true);
  perform public.open_signal_drop(probe);
  perform pg_temp.ok((select status='spent' from public.signal_drops where id=probe), 'empty opening permanently spends drop');
  delete from public.cosmetic_ownership where user_id=a and cosmetic_id='ASTRAL';
  select d.cosmetic_id into drop_id from public.open_signal_drop(probe) d;
  perform pg_temp.ok(drop_id is null, 'spent drop cannot reroll when a reward becomes eligible later');
  perform set_config('playhead.authorized_cosmetic_write','1',true);
  insert into public.cosmetic_ownership(user_id,cosmetic_id,unlock_source) values(a,'ASTRAL','TEST');
  perform set_config('playhead.authorized_cosmetic_write','0',true);
  v := public.accept_leaderboard_run(a,'A',t2,1,'fp1',500000,'DIAMOND','m','g','b',null,null,null,1,0);
  perform pg_temp.ok(v->>'signal_drop_id' is null, 'collection complete mints no useless drop');
  perform pg_temp.ok(exists(select 1 from public.awarded_diamond_drop_tracks where user_id=a and track_id=t2),
    'achievement marker still recorded when collection complete');

  -- -----------------------------------------------------------------------
  -- 4. BLACKSTAR excluded / reserved; NULL catalog probe is safe
  -- -----------------------------------------------------------------------
  perform pg_temp.ok(not public.is_signal_drop_cosmetic('BLACKSTAR'), 'BLACKSTAR is not a Signal Drop cosmetic');
  perform pg_temp.ok(public.is_reserved_cosmetic('BLACKSTAR'), 'BLACKSTAR remains reserved');
  perform pg_temp.ok(not public.is_signal_drop_cosmetic(null::text), 'NULL catalog probe returns false');

  -- -----------------------------------------------------------------------
  -- 5. Auth cross-account denial
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', b::text, true);
  blocked := false;
  begin perform public.open_signal_drop(drop1); exception when others then blocked := true; end;
  perform pg_temp.ok(blocked, 'another account cannot open a foreign drop');
  ledger := public.my_signal_drop_ledger();
  perform pg_temp.ok(jsonb_typeof(ledger->'opened') = 'array' and jsonb_array_length(ledger->'opened') = 0,
    'b ledger does not leak a opened ids');

  -- -----------------------------------------------------------------------
  -- 6. Direct INSERT + generic progression paths cannot mint a drop cosmetic
  -- -----------------------------------------------------------------------
  blocked := false;
  begin
    execute 'set local role authenticated';
    perform public.grant_progression_events(jsonb_build_array(jsonb_build_object('kind','own_cosmetic','key','ASTRAL')));
  exception when others then blocked := true;
  end;
  execute 'reset role';
  perform pg_temp.ok(
    not exists(select 1 from public.cosmetic_ownership o where o.user_id=b and o.cosmetic_id='ASTRAL')
      or public.signal_drop_owned_cosmetic(b,'ASTRAL'),
    'own_cosmetic cannot mint an unearned Signal Drop cosmetic');

  blocked := false;
  begin
    execute 'set local role authenticated';
    insert into public.cosmetic_ownership(user_id,cosmetic_id,unlock_source) values(b,'ASTRAL','TEST');
  exception when others then blocked := true;
  end;
  execute 'reset role';
  perform pg_temp.ok(blocked, 'direct INSERT of a Signal Drop cosmetic is denied');

  blocked := false;
  begin
    execute 'set local role authenticated';
    perform public.sync_progression(p_reward_owned_skin_ids => array['ASTRAL']);
  exception when others then blocked := true;
  end;
  execute 'reset role';
  perform pg_temp.ok(
    not exists(select 1 from public.cosmetic_ownership o where o.user_id=b and o.cosmetic_id='ASTRAL')
      or public.signal_drop_owned_cosmetic(b,'ASTRAL'),
    'sync_progression cannot mint an unearned Signal Drop cosmetic');

  -- -----------------------------------------------------------------------
  -- 7. Legitimate owned / equipment saves; WR-reserved preserved
  -- -----------------------------------------------------------------------
  v := public.accept_leaderboard_run(c,'C',t1,1,'fp1',1000000,'DIAMOND','m','g','b',null,null,null,1,0);
  drop3 := (v->>'signal_drop_id')::uuid;
  perform set_config('request.jwt.claim.sub', c::text, true);
  select d.cosmetic_id into drop_id from public.open_signal_drop(drop3) d;

  blocked := false;
  begin
    execute 'set local role authenticated';
    insert into public.cosmetic_ownership(user_id,cosmetic_id,unlock_source) values(c,drop_id,'PROGRESSION')
      on conflict do nothing;
  exception when others then blocked := true;
  end;
  execute 'reset role';
  perform pg_temp.ok(not blocked, 're-insert of an already-owned Signal Drop id is admitted');

  prog := public.sync_progression(p_equipped_knife => drop_id);
  perform pg_temp.ok((select equipped_knife from public.player_progress where user_id=c) = drop_id,
    'equipment save of an owned Signal Drop id is preserved');

  blocked := false;
  begin
    execute 'set local role authenticated';
    insert into public.cosmetic_ownership(user_id,cosmetic_id,unlock_source) values(c,'BLACKSTAR','WORLD_RECORD');
  exception when others then blocked := true;
  end;
  execute 'reset role';
  perform pg_temp.ok(blocked, 'WORLD_RECORD provenance stays server-authoritative');
  -- Legitimate pre-migration reserved ownership still saves.
  insert into public.pre_migration_cosmetic_snapshot(user_id,cosmetic_id) values(c,'BLACKSTAR') on conflict do nothing;
  blocked := false;
  begin
    execute 'set local role authenticated';
    insert into public.cosmetic_ownership(user_id,cosmetic_id,unlock_source) values(c,'BLACKSTAR','PROGRESSION')
      on conflict do nothing;
  exception when others then blocked := true;
  end;
  execute 'reset role';
  perform pg_temp.ok(not blocked, 'historical reserved ownership still saves');

  -- -----------------------------------------------------------------------
  -- 8. LEGACY migration conversion (sentinel seed must have run BEFORE migration)
  -- -----------------------------------------------------------------------
  if exists (select 1 from auth.users where id = 'aaaaaaaa-0000-4000-8000-0000000000aa') then
    perform pg_temp.ok(
      (select count(*) from public.signal_drops
        where user_id='aaaaaaaa-0000-4000-8000-0000000000aa'
          and track_key in ('legacy:track_01_legacy:GOLD','legacy:track_02_legacy:GOLD')) = 2,
      'two distinct unspent GOLD keys migrate as two drops');
    perform pg_temp.ok(
      not exists(select 1 from public.signal_drops
        where user_id='aaaaaaaa-0000-4000-8000-0000000000aa'
          and track_key = 'legacy:track_03_legacy:GOLD'),
      'a previously-spent GOLD key does not resurrect');
    perform pg_temp.ok(
      (select count(*) from public.awarded_diamond_drop_tracks
        where user_id='aaaaaaaa-0000-4000-8000-0000000000aa'
          and track_id in ('track_05_legacy','track_06_legacy')) = 2,
      'historical Diamond ledger includes SPENT and unspent tracks');
    perform pg_temp.ok(
      (select count(*) from public.signal_drops
        where user_id='aaaaaaaa-0000-4000-8000-0000000000aa'
          and track_key = 'legacy:track_06_legacy:DIAMOND') = 1,
      'unspent DIAMOND key migrates exactly one legacy drop');
    perform pg_temp.ok(
      (select spent_drop_keys from public.player_progress
        where user_id='aaaaaaaa-0000-4000-8000-0000000000aa') @>
        array['track_03_legacy:GOLD','track_05_legacy:DIAMOND'],
      'original spent keys are preserved after migration');
    perform pg_temp.ok(
      (select spent_drop_keys from public.player_progress
        where user_id='aaaaaaaa-0000-4000-8000-0000000000aa') @>
        array['track_01_legacy:GOLD','track_02_legacy:GOLD','track_06_legacy:DIAMOND'],
      'newly migrated keys are consumed into spent_drop_keys');
  end if;

  -- -----------------------------------------------------------------------
  -- 9. Re-run safety: (account, track_key) has no duplicates
  -- -----------------------------------------------------------------------
  perform pg_temp.ok(
    (select count(*) from (
       select 1 from public.signal_drops group by user_id, track_key having count(*) > 1
     ) dup) = 0,
    'no duplicate (user_id, track_key) rows exist');
end $$;

rollback;
