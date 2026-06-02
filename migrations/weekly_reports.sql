-- Table de persistance des rapports hebdomadaires (Weekly Market Recap généré par IA).
-- But : conserver durablement un recap déjà généré pour NE PAS le régénérer (et donc ne pas
-- reconsommer de requêtes Gemini) après un redémarrage Render (disque éphémère).
-- À exécuter une fois dans Supabase → SQL Editor. Tant qu'elle n'existe pas, l'app bascule
-- sur un stockage fichier (cache_weekly.json) — fonctionnel mais éphémère sur Render.

create table if not exists public.weekly_reports (
  week_key    text        primary key,          -- ex. "2026-W22" (semaine ISO couverte)
  report      jsonb       not null,             -- l'item complet du recap (_weekly inclus)
  created_at  timestamptz not null default now()
);

create index if not exists weekly_reports_created_idx on public.weekly_reports (created_at desc);

-- Le backend utilise la clé service_role (accès complet) — RLS non requis côté serveur.
alter table public.weekly_reports enable row level security;
