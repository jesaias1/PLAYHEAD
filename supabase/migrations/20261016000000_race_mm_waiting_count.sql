-- How many players are searching right now (same mode), for the "N searching" line.
-- Counts only entries that are still polling (seen in the last 25 seconds).
create or replace function public.race_mm_waiting_count_v1(p_mode text default 'SURF')
returns integer
language plpgsql security definer set search_path = public as $$
declare
  m text := case when upper(coalesce(p_mode, 'SURF')) = 'NORMAL' then 'NORMAL' else 'SURF' end;
  n integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select count(*) into n
    from public.race_matchmaking_queue q
   where q.status = 'WAITING' and q.mode = m and q.last_seen_at > now() - interval '25 seconds';
  return coalesce(n, 0);
end;
$$;

revoke execute on function public.race_mm_waiting_count_v1(text) from public, anon;
grant execute on function public.race_mm_waiting_count_v1(text) to authenticated;
