-- Journal d'emails "campagne" (anti-doublon durable).
-- But : ne JAMAIS renvoyer deux fois un email automatisé (ex. incitation fin d'essai
-- gratuit) à un même client, même après un redémarrage Render (disque éphémère).
-- À exécuter une fois dans Supabase → SQL Editor. Tant qu'elle n'existe pas, l'app
-- bascule sur un stockage fichier (cache_email_log.json) — fonctionnel mais éphémère.

create table if not exists public.email_log (
  key      text        primary key,           -- ex. "trial-upsell:<userId>:<expires_at>"
  sent_at  timestamptz not null default now()
);

create index if not exists email_log_sent_idx on public.email_log (sent_at desc);

-- Le backend utilise la clé service_role (accès complet) — RLS non requis côté serveur.
alter table public.email_log enable row level security;
