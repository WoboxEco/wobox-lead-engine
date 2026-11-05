-- Destinatario real usado al enviar un mensaje (puede diferir del email actual
-- del contacto si el founder lo editó en "Para:" justo antes de enviar).
alter table messages add column if not exists sent_to text;
