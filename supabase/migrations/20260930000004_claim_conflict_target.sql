create or replace function public.claim_world_record_award(p_award_id text)
returns table (cosmetic_id text, granted boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_row      public.player_world_records;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_award_id is null or p_award_id = '' then raise exception 'award id required'; end if;

  select * into v_row
  from public.player_world_records
  where user_id = v_user and award_id = p_award_id
  for update;

  if v_row.award_id is null then
    raise exception 'no world record award for this account';
  end if;

  if v_row.claimed then
    return query select v_row.cosmetic_id, false;
    return;
  end if;

  -- This is the ONLY authenticated path allowed to grant a reserved reward.
  perform set_config('playhead.authorized_cosmetic_write', '1', true);
  perform set_config('playhead.authorized_progress_write', '1', true);

  insert into public.cosmetic_ownership (user_id, cosmetic_id, unlock_source)
  values (v_user, v_row.cosmetic_id, 'WORLD_RECORD')
  on conflict on constraint cosmetic_ownership_pkey do nothing;

  insert into public.player_progress (user_id) values (v_user)
  on conflict (user_id) do nothing;

  update public.player_progress
  set reward_owned_skin_ids = (
        select coalesce(array_agg(distinct c), '{}')
        from unnest(coalesce(reward_owned_skin_ids, '{}') || array[v_row.cosmetic_id]) as c
        where c is not null and c <> ''
      ),
      updated_at = now()
  where user_id = v_user;

  update public.player_world_records
  set claimed = true
  where user_id = v_user and award_id = p_award_id;

  perform set_config('playhead.authorized_cosmetic_write', '0', true);
  perform set_config('playhead.authorized_progress_write', '0', true);

  return query select v_row.cosmetic_id, true;
exception when others then
  -- ALWAYS drop the privileged flags before re-raising: the transaction-local
  -- config is discarded on rollback, but resetting here keeps the invariant
  -- explicit and safe even if this body is ever reused inside a savepoint.
  perform set_config('playhead.authorized_cosmetic_write', '0', true);
  perform set_config('playhead.authorized_progress_write', '0', true);
  raise;
end;
$$;
