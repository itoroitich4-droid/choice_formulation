-- Expand the feed analysis model. Legacy Energy values were stored as kcal/kg;
-- the new ME field is kcal/g, so convert existing records and recipe snapshots.
create or replace function public.choice_convert_nutrients(doc jsonb) returns jsonb
language sql immutable as $$
  select case when coalesce(doc, '{}'::jsonb) ? 'energy'
      and coalesce(doc, '{}'::jsonb)->'energy' <> 'null'::jsonb
      and not (coalesce(doc, '{}'::jsonb) ? 'me')
    then jsonb_set(coalesce(doc, '{}'::jsonb) - 'energy', '{me}', to_jsonb(((doc->>'energy')::numeric) / 1000), true)
    else coalesce(doc, '{}'::jsonb) - 'energy' end
$$;
create or replace function public.choice_convert_targets(doc jsonb) returns jsonb
language sql immutable as $$
  select case when coalesce(doc, '{}'::jsonb) ? 'energy'
      and coalesce(doc, '{}'::jsonb)->'energy' <> 'null'::jsonb
      and not (coalesce(doc, '{}'::jsonb) ? 'me') then jsonb_set(coalesce(doc, '{}'::jsonb) - 'energy', '{me}', jsonb_build_object(
    'min', case when doc->'energy'->>'min' is null then null else to_jsonb(((doc->'energy'->>'min')::numeric) / 1000) end,
    'max', case when doc->'energy'->>'max' is null then null else to_jsonb(((doc->'energy'->>'max')::numeric) / 1000) end), true)
    else coalesce(doc, '{}'::jsonb) - 'energy' end
$$;
update public.ingredients set nutrients = public.choice_convert_nutrients(nutrients) where nutrients ? 'energy';
update public.products set targets = public.choice_convert_targets(targets) where targets ? 'energy';
-- Repair legacy rows with null JSON summaries before the conversion update.
update public.formulations set summary = '{}'::jsonb where summary is null or summary = 'null'::jsonb;
update public.formulations
set targets = public.choice_convert_targets(targets),
    summary = case when coalesce(nullif(summary, 'null'::jsonb)->'nutrients', '{}'::jsonb) ? 'energy'
      then jsonb_set(coalesce(nullif(summary, 'null'::jsonb), '{}'::jsonb), '{nutrients}', public.choice_convert_nutrients(summary->'nutrients'), true)
      else coalesce(nullif(summary, 'null'::jsonb), '{}'::jsonb) end,
    lines = coalesce((select jsonb_agg(case when (ln->'snapshot'->'nutrients') ? 'energy'
      then jsonb_set(ln, '{snapshot,nutrients}', public.choice_convert_nutrients(ln->'snapshot'->'nutrients'), true) else ln end)
      from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) as entries(ln)), '[]'::jsonb)
where coalesce(targets, '{}'::jsonb) ? 'energy'
   or coalesce(nullif(summary, 'null'::jsonb)->'nutrients', '{}'::jsonb) ? 'energy'
   or coalesce(lines, '[]'::jsonb)::text like '%"energy"%';
drop function public.choice_convert_nutrients(jsonb);
drop function public.choice_convert_targets(jsonb);
