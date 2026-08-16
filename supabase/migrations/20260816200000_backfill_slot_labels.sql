-- Slots created before auto-naming shipped have label = null, which showed
-- as "No name" in Settings > Schedule. Backfill them with the same
-- "<Morning/Afternoon/Evening> <Weekday> Session" format the Edge Function
-- now generates at creation time. Anyone can still rename these afterwards.
update public.session_slots
set label = (
  case
    when extract(hour from kickoff) < 12 then 'Morning'
    when extract(hour from kickoff) < 17 then 'Afternoon'
    else 'Evening'
  end
) || ' ' || (
  array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
)[weekday + 1] || ' Session'
where label is null;
