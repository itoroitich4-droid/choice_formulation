-- Choice Nutrition starter catalogue (names and pack sizes supplied by the company).
-- Prices and nutrient analyses are intentionally blank except the Myco Protein label minimum (65% crude protein).
-- Run once as the project owner (the SQL editor bypasses RLS).

insert into public.products (name, kind, animal, pack) values
  ('Chick & Duck Premix','premix','Poultry','25 kg bag'),
  ('Grower Premix','premix','Grower','25 kg bag'),
  ('Layer Premix','premix','Layers','25 kg bag'),
  ('Dairy Premix','premix','Dairy','25 kg bag'),
  ('Sow & Weaner Premix','premix','Pigs','25 kg bag'),
  ('Pig Finisher Premix','premix','Pigs','25 kg bag'),
  ('General Purpose Premix','premix','General','25 kg bag')
on conflict do nothing;

insert into public.ingredients (name, category, pack, source, nutrients) values
  ('DL-Methionine','Amino acid','25 kg','Nutrient data and price not yet entered.','{}'),
  ('Dicalcium Phosphate (DCP) Granular','Mineral','25 kg bag','Nutrient data and price not yet entered.','{}'),
  ('Toxin Binder','Enzyme / additive','25 kg bag','Nutrient data and price not yet entered.','{}'),
  ('Lysin HCL','Amino acid','25 kg','Nutrient data and price not yet entered.','{}'),
  ('Betra Sacc','Enzyme / additive','25 kg','Nutrient data and price not yet entered.','{}'),
  ('Cocci Diostat','Enzyme / additive','25 kg bag','Nutrient data and price not yet entered.','{}'),
  ('Myco Protein (65% CP min)','Protein source','40 kg bag','Product label: minimum 65% crude protein; verify specification before use.','{"protein": 65}'),
  ('Energy Compound (Palm Oil)','Oil / fat','25 kg bag','Nutrient data and price not yet entered.','{}'),
  ('Threonine','Amino acid','25 kg','Nutrient data and price not yet entered.','{}'),
  ('Complex Enzyme (Pure)','Enzyme / additive','25 kg pack','Nutrient data and price not yet entered.','{}'),
  ('Enerzyme (Phytase)','Enzyme / additive','25 kg bag','Nutrient data and price not yet entered.','{}'),
  ('Egg Colour','Enzyme / additive','25 kg bag','Nutrient data and price not yet entered.','{}'),
  ('MCP (Monocalcium Phosphate)','Mineral',null,'Nutrient data and price not yet entered.','{}')
on conflict do nothing;
