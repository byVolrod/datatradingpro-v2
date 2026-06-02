-- Cache IA durable (anti-régénération / anti-doublon).
-- But : conserver les résultats IA déjà calculés (AI Insights d'un rapport, etc.) afin de
-- NE PAS rappeler l'IA quand un utilisateur rouvre un rapport — y compris après un
-- redémarrage Render (disque éphémère). À exécuter une fois dans Supabase → SQL Editor.
-- Tant que la table n'existe pas, l'app bascule sur un fichier (cache_ai_store.json),
-- fonctionnel mais éphémère.

create table if not exists public.ai_cache (
  key         text        primary key,           -- ex. "ins:v2:<reportId>"
  value       jsonb       not null,              -- le résultat IA (ex. tableau d'insights)
  created_at  timestamptz not null default now()
);

create index if not exists ai_cache_created_idx on public.ai_cache (created_at desc);

-- Le backend utilise la clé service_role (accès complet) — RLS non requis côté serveur.
alter table public.ai_cache enable row level security;
