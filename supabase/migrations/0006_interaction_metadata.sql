-- metadata generico para interactions: status_change guarda {from_stage,to_stage},
-- futuro sync de Gmail podria guardar {gmail_message_id, thread_id} sin migration nueva.

alter table interactions add column if not exists metadata jsonb not null default '{}'::jsonb;
