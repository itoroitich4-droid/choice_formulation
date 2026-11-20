-- User-supplied ingredient catalogue (30 records).
-- Axtra ME/D.E figures were converted from kcal/kg to kcal/g; its percentage
-- figures over 100 were scaled by 1/100 as confirmed by the user. All other
-- figures are stored as supplied. Min/Max kg are intentionally omitted.
-- Ca:P Ratio is calculated by the application from Calcium and Total P.
-- Zero values are explicitly stored as zero. Three blank starter rows are renamed
-- to match the supplied names: Dl methionine, DCP, and Coccidiostat.
update public.ingredients old set name = 'Dl methionine'
where lower(old.name) = 'dl-methionine'
  and not exists (select 1 from public.ingredients x where lower(x.name) = 'dl methionine');
update public.ingredients old set name = 'DCP'
where lower(old.name) = 'dicalcium phosphate (dcp) granular'
  and not exists (select 1 from public.ingredients x where lower(x.name) = 'dcp');
update public.ingredients old set name = 'Coccidiostat'
where lower(old.name) = 'cocci diostat'
  and not exists (select 1 from public.ingredients x where lower(x.name) = 'coccidiostat');

with defaults as (
  select '{"availability":0,"dm":0,"me":0,"de":0,"protein":0,"tdn":0,"fat":0,"fibre":0,"calcium":0,"phosphorus":0,"available_phosphorus":0,"sodium":0,"chloride":0,"lysine":0,"methionine":0,"ap_lysine":0,"ap_methionine":0,"ap_tsaa":0,"ap_threonine":0,"ap_tryptophan":0,"ap_arginine":0,"ap_valine":0,"ap_isoleucine":0,"ap_histidine":0,"ap_leucine":0,"rup":0,"starch":0,"adf":0,"ndf":0,"ash":0}'::jsonb as nutrients
), seed(name, category, cost_per_kg, nutrients, source) as (
  values
  ('Antioxidant BHT','Enzyme / additive',920,'{"availability":1,"dm":99}'::jsonb,'User supplied'),
  ('Axtra PHY Gold 10G_Pigs','Enzyme / additive',0,'{"availability":1,"dm":99,"me":6.11544,"de":6.11544,"protein":42.52,"calcium":17.60,"available_phosphorus":18.14,"sodium":1.57,"lysine":2.19,"methionine":0.46,"ap_lysine":2.19,"ap_methionine":0.46,"ap_tsaa":2.21,"ap_threonine":2.14,"ap_tryptophan":1.23,"ap_arginine":2.20,"ap_valine":2.30,"ap_isoleucine":4.18,"ap_histidine":1.39,"ap_leucine":6.19}'::jsonb,'User supplied; energy converted from kcal/kg and percentages scaled by 1/100'),
  ('Axtra Phy Gold 10G_Broiler','Enzyme / additive',0,'{"availability":1,"dm":99,"me":0.66095,"de":0.66095,"protein":67.56,"calcium":21.63,"available_phosphorus":22.81,"sodium":5.08,"lysine":3.29,"methionine":1.91,"ap_lysine":3.29,"ap_methionine":1.91,"ap_tsaa":3.62,"ap_threonine":3.03,"ap_tryptophan":0.57,"ap_arginine":3.13,"ap_valine":3.05,"ap_isoleucine":2.90,"ap_histidine":1.51,"ap_leucine":5.57}'::jsonb,'User supplied; energy converted from kcal/kg and percentages scaled by 1/100'),
  ('Axtra Phy Gold 10G_Layer','Enzyme / additive',0,'{"availability":1,"dm":99,"me":7.03178,"de":7.03178,"protein":78.15,"calcium":27.67,"available_phosphorus":23.64,"sodium":4.96,"lysine":3.97,"methionine":2.43,"ap_lysine":3.97,"ap_methionine":2.43,"ap_tsaa":4.83,"ap_threonine":3.78,"ap_tryptophan":0.79,"ap_arginine":4.10,"ap_valine":4.00,"ap_isoleucine":4.59,"ap_histidine":2.45,"ap_leucine":8.23}'::jsonb,'User supplied; energy converted from kcal/kg and percentages scaled by 1/100'),
  ('Betaine','Enzyme / additive',300,'{"availability":0,"dm":100}'::jsonb,'User supplied'),
  ('Black Soldier Fly >30%','Protein source',0,'{"availability":1,"dm":91.70,"me":4.91,"protein":38,"tdn":92,"fat":32.60,"fibre":8.70,"calcium":30.30,"phosphorus":6.60,"available_phosphorus":5.60,"sodium":0.91,"chloride":1.40,"lysine":21.80,"methionine":6.80,"ap_lysine":18.80,"ap_methionine":6,"ap_tsaa":7.80,"ap_threonine":12.40,"ap_tryptophan":4.30,"ap_arginine":17.20,"ap_valine":20,"ap_isoleucine":1.40,"ap_histidine":0.71,"ap_leucine":2.34,"rup":42.01,"starch":0.80,"adf":8.40,"ndf":11,"ash":10.70}'::jsonb,'User supplied'),
  ('Blood meal','Protein source',150,'{"availability":1,"dm":92,"me":3,"de":4.50,"protein":87,"tdn":60.20,"fat":0.90,"calcium":0.20,"phosphorus":0.20,"available_phosphorus":0.10,"sodium":0.30,"chloride":0.40,"lysine":8.10,"methionine":1,"ap_lysine":3.90,"ap_methionine":0.60,"ap_tsaa":1,"ap_threonine":2.40,"ap_tryptophan":0.50,"ap_arginine":2.40,"ap_valine":4.80,"ap_isoleucine":0.86,"ap_histidine":4.60,"ap_leucine":9,"rup":57.50,"ash":2.60}'::jsonb,'User supplied'),
  ('Bone meal','Mineral',35,'{"availability":1,"dm":92,"me":1,"protein":24,"fat":3.50,"fibre":1,"calcium":22,"phosphorus":9.50,"available_phosphorus":7,"sodium":0.30,"chloride":0.10,"ap_lysine":1.10,"ap_methionine":0.20,"ap_tsaa":0.30,"ap_threonine":0.60,"ap_tryptophan":0.10,"ap_arginine":1.70,"ap_valine":0.80,"ndf":0.60,"ash":50}'::jsonb,'User supplied'),
  ('Bone meal steamed','Mineral',40,'{"availability":1,"dm":92,"me":0.30,"protein":8,"fat":3.50,"fibre":1,"calcium":32.50,"phosphorus":15,"available_phosphorus":7,"ap_lysine":0.40,"ap_methionine":0.10,"ap_tsaa":0.10,"ap_threonine":0.20,"ap_arginine":0.60,"ap_valine":0.30,"ndf":0.60,"ash":16.70}'::jsonb,'User supplied'),
  ('Broiler premix','Vitamin / premix component',500,'{"availability":1,"dm":99}'::jsonb,'User supplied'),
  ('Calcium Propionate','Enzyme / additive',191.04,'{"availability":1,"dm":99}'::jsonb,'User supplied'),
  ('Calf Premix','Vitamin / premix component',250,'{"availability":1,"dm":99}'::jsonb,'User supplied'),
  ('Canola Cake','Protein source',40,'{"availability":1,"dm":90,"me":2.80,"de":3.30,"protein":30,"tdn":64,"fat":15.70,"fibre":11.70,"calcium":0.70,"phosphorus":1.20,"available_phosphorus":0.40,"chloride":0.10,"lysine":1.90,"methionine":0.70,"ap_lysine":1.30,"ap_methionine":0.70,"ap_tsaa":1.30,"ap_threonine":1.30,"ap_tryptophan":0.30,"ap_arginine":1.10,"ap_valine":1.40,"ap_isoleucine":1.02,"ap_histidine":0.70,"ap_leucine":1.70,"rup":8.90,"starch":19,"adf":19.70,"ndf":25.50,"ash":7}'::jsonb,'User supplied'),
  ('Canola Full Fat','Protein source',65,'{"availability":1,"dm":90,"me":2,"de":3.80,"protein":21,"tdn":64,"fat":37,"fibre":7.20,"calcium":0.40,"phosphorus":0.70,"available_phosphorus":0.20,"sodium":0.10,"chloride":0.10,"lysine":1.20,"methionine":0.40,"ap_lysine":1,"ap_methionine":0.40,"ap_tsaa":0.80,"ap_threonine":0.80,"ap_tryptophan":0.20,"ap_arginine":1.20,"ap_valine":0.80,"ap_isoleucine":1,"ap_histidine":0.70,"ap_leucine":0.70,"rup":5.40,"starch":19,"adf":19.70,"ndf":25.50,"ash":7}'::jsonb,'User supplied'),
  ('Canola Meal','Protein source',40,'{"availability":1,"dm":90,"me":2,"de":3.30,"protein":30,"tdn":64,"fat":3,"fibre":11.70,"calcium":0.70,"phosphorus":1.20,"available_phosphorus":0.40,"sodium":0.05,"chloride":0.10,"lysine":1.90,"methionine":0.70,"ap_lysine":1.60,"ap_methionine":0.60,"ap_tsaa":1.30,"ap_threonine":1.30,"ap_tryptophan":0.40,"ap_arginine":1.90,"ap_valine":1.40,"ap_isoleucine":1.02,"ap_histidine":0.70,"ap_leucine":1.70,"rup":8.90,"starch":19,"adf":19.70,"ndf":25.50,"ash":7}'::jsonb,'User supplied'),
  ('Canola Meal 30%','Protein source',30,'{"availability":1,"dm":90,"me":2.40,"de":3.50,"protein":30,"tdn":64,"fat":15.70,"fibre":11.70,"calcium":0.70,"phosphorus":1.20,"available_phosphorus":0.40,"sodium":0.05,"chloride":0.10,"lysine":1.90,"methionine":0.70,"ap_lysine":1.30,"ap_methionine":0.70,"ap_tsaa":1.30,"ap_threonine":1.30,"ap_tryptophan":0.30,"ap_arginine":1.10,"ap_valine":1.40,"ap_isoleucine":1,"ap_histidine":0.70,"ap_leucine":1.70,"rup":8.90,"starch":19,"adf":19.70,"ndf":25.50,"ash":7}'::jsonb,'User supplied'),
  ('Canola Meal 35%','Protein source',60,'{"availability":1,"dm":90,"me":2,"de":3.60,"protein":35,"tdn":64,"fat":3,"fibre":11.70,"calcium":0.70,"phosphorus":1.20,"available_phosphorus":0.40,"sodium":0.50,"chloride":0.10,"lysine":1.90,"methionine":0.70,"ap_lysine":1.60,"ap_methionine":0.60,"ap_tsaa":1.30,"ap_threonine":1.30,"ap_tryptophan":0.40,"ap_arginine":1.90,"ap_valine":1.40,"ap_isoleucine":1,"ap_histidine":0.70,"ap_leucine":1.70,"rup":8.90,"starch":19,"adf":19.70,"ndf":25.50,"ash":7}'::jsonb,'User supplied'),
  ('Cassava 66% Starch','Grain / energy',0,'{"availability":1,"dm":87.70,"me":3.14,"de":3.10,"protein":2.50,"tdn":72,"fat":0.60,"fibre":3.80,"calcium":1.60,"phosphorus":0.90,"available_phosphorus":0.20,"sodium":0.35,"chloride":0.20,"lysine":1,"methionine":0.20,"ap_lysine":0.50,"ap_methionine":0.20,"ap_tsaa":0.50,"ap_threonine":0.40,"ap_tryptophan":0.10,"ap_arginine":0.50,"ap_valine":0.60,"ap_isoleucine":0.04,"ap_histidine":0.05,"ap_leucine":0.07,"rup":40,"starch":68.70,"adf":5.20,"ndf":7.80,"ash":3.90}'::jsonb,'User supplied'),
  ('Cattle Salt','Mineral',10,'{"availability":1,"dm":99,"sodium":38,"chloride":60}'::jsonb,'User supplied'),
  ('Choline Chloride','Enzyme / additive',160,'{"availability":1,"dm":99}'::jsonb,'User supplied'),
  ('Coccidiostat','Enzyme / additive',400,'{"availability":1,"dm":99}'::jsonb,'User supplied'),
  ('Cotton Meal 25%','Protein source',57,'{"availability":1,"dm":90,"me":2.20,"de":3.20,"protein":25,"tdn":73,"fat":5,"fibre":25,"calcium":0.20,"phosphorus":0.90,"available_phosphorus":0.30,"lysine":1.10,"methionine":0.40,"ap_lysine":0.80,"ap_methionine":0.30,"ap_tsaa":0.60,"ap_threonine":0.60,"ap_tryptophan":0.20,"ap_arginine":2.20,"ap_valine":0.80,"ap_isoleucine":0.93,"ap_histidine":0.92,"ap_leucine":1.70,"rup":12.50,"starch":15.20,"adf":19.20,"ndf":28.30,"ash":6.50}'::jsonb,'User supplied'),
  ('Cotton O/C','Protein source',55,'{"availability":1,"dm":90,"me":2.20,"de":3.10,"protein":38,"tdn":73,"fat":2.40,"fibre":13.50,"calcium":0.20,"phosphorus":0.90,"available_phosphorus":0.30,"sodium":0.06,"lysine":1.70,"methionine":0.60,"ap_lysine":1.20,"ap_methionine":0.40,"ap_tsaa":0.90,"ap_threonine":0.90,"ap_tryptophan":0.40,"ap_arginine":3.40,"ap_valine":1.20,"ap_isoleucine":0.93,"ap_histidine":0.92,"ap_leucine":1.70,"rup":14.70,"starch":15.20,"adf":19.20,"ndf":28.30,"ash":6.50}'::jsonb,'User supplied'),
  ('Cre Amino','Amino acid',1150,'{"availability":1,"dm":99.90,"me":2.50,"protein":22.10,"ap_arginine":77}'::jsonb,'User supplied'),
  ('DCP','Mineral',180,'{"availability":1,"dm":99,"calcium":23,"phosphorus":18,"available_phosphorus":14}'::jsonb,'User supplied'),
  ('DDGS','Protein source',50,'{"availability":1,"dm":89,"me":2.80,"de":3.50,"protein":27.50,"tdn":77,"fat":9.60,"fibre":6.40,"calcium":0.70,"phosphorus":0.80,"available_phosphorus":0.60,"sodium":0.20,"chloride":0.10,"lysine":0.80,"methionine":0.60,"ap_lysine":0.70,"ap_methionine":0.50,"ap_tsaa":1,"ap_threonine":0.80,"ap_tryptophan":0.20,"ap_arginine":1,"ap_valine":1.20,"ap_isoleucine":0.64,"ap_histidine":0.39,"ap_leucine":2,"rup":47,"adf":10.90,"ash":5.30}'::jsonb,'User supplied'),
  ('Dl methionine','Amino acid',720,'{"availability":1,"dm":99,"me":5,"protein":59,"methionine":98,"ap_methionine":98,"ap_tsaa":98}'::jsonb,'User supplied'),
  ('Dairy Premix','Vitamin / premix component',170,'{"availability":1,"dm":99}'::jsonb,'User supplied'),
  ('Dog premix','Vitamin / premix component',450,'{"availability":1,"dm":91}'::jsonb,'User supplied'),
  ('Dry yeast','Protein source',250,'{"availability":1,"dm":99}'::jsonb,'User supplied')
)
insert into public.ingredients (name, category, cost_per_kg, source, nutrients)
select s.name, s.category, s.cost_per_kg, s.source, d.nutrients || s.nutrients
from seed s cross join defaults d
on conflict (lower(name)) do update set
  category = excluded.category,
  cost_per_kg = excluded.cost_per_kg,
  source = excluded.source,
  nutrients = excluded.nutrients;