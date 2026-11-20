-- Clean source details that do not map to supported nutrient keys and remove
-- product assay values that were incorrectly mapped to feed DM/protein fields.
update public.ingredients
set nutrients = nutrients - 'xanthophyll' - 'canthaxanthin'
where lower(name) = 'egg pigment'
  and (nutrients ? 'xanthophyll' or nutrients ? 'canthaxanthin');

-- Product assay/purity percentages are not feed dry matter or crude protein.
update public.ingredients
set nutrients = nutrients - 'dm' - 'protein'
where lower(name) in ('guanidino aa', 'l threonine', 'l tryptophan', 'l-valine', 'lysine hcl', 'mepron');

-- Protected methionine assays are not poultry digestible-AA values.
update public.ingredients
set nutrients = nutrients - 'ap_methionine' - 'ap_tsaa'
where lower(name) in ('mepron', 'smartamin m');

update public.ingredients
set nutrients = '{}'::jsonb
where lower(name) = 'guanidino aa' and nutrients <> '{}'::jsonb;
