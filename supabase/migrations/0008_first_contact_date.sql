-- Fecha de primer contacto: dispara la creacion automatica de dos tasks de
-- seguimiento (3 y 7 dias despues) desde la UI del company detail.
alter table companies add column if not exists first_contact_date date;
