-- Issue 10 — WhatsApp ingestion target: the "active" round.
-- WhatsApp Cloud API has a single business number; an inbound scorecard photo does
-- not say which round it belongs to. The organizer marks ONE round as "receiving by
-- WhatsApp"; the processing queue attaches inbound plicas to it and resolves the
-- competition/club from that round. Only one round per competition can be active at
-- a time (enforced by the toggle action); the queue picks an active round.
alter table round add column whatsapp_active boolean not null default false;

-- Fast lookup of the active round(s).
create index round_whatsapp_active_idx on round (whatsapp_active) where whatsapp_active;
