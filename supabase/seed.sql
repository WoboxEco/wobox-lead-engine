-- Opcional: fixture minima para probar score-leads end-to-end.
-- Correr desde el SQL Editor de Supabase tras setup-database.

insert into companies (name, venture, subsector, locations_count, region, neighborhood, source, stage)
values ('Cafe de Especialidad Demo', 'loop', 'cafeteria', 2, 'CABA', 'Palermo', 'manual', 'new')
returning id;
