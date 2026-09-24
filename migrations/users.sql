-- Table des comptes (24/09) — elle n'avait AUCUNE migration dans le dépôt : une restauration vers un
-- nouveau projet Supabase ne pouvait pas la recréer. Schéma relevé tel quel sur la base principale
-- (information_schema, 24/09/2026). Les colonnes et leurs valeurs par défaut sont celles que lit auth.js.
create table if not exists public.users (
  id             text        primary key,
  email          text        not null,
  password_hash  text        not null,
  name           text        default '',
  role           text        default 'client',
  plan           text        default 'full',
  active         boolean     default true,
  created_at     timestamptz default now(),
  last_login     timestamptz,
  expires_at     timestamptz
);

create index if not exists idx_users_expires_at on public.users (expires_at);

-- Le backend utilise la clé service_role (accès complet) — RLS activé, aucune politique : rien n'est
-- lisible depuis un navigateur.
alter table public.users enable row level security;

-- ACCÈS DATA API EXPLICITE — Supabase cesse le 30/10/2026 d'accorder automatiquement l'accès aux
-- NOUVELLES tables du schéma public. On n'ouvre QUE service_role (serveur), jamais anon/authenticated.
grant select, insert, update, delete on public.users to service_role;
