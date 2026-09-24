-- Table de chat support — à exécuter dans Supabase (SQL Editor) pour la persistance en BDD.
-- Tant qu'elle n'existe pas, l'app bascule sur un stockage fichier (cache_chat.json) — fonctionnel mais éphémère sur Render.

create table if not exists public.chat_messages (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  sender      text        not null check (sender in ('user','support')),
  text        text        not null,
  read        boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_user_idx    on public.chat_messages (user_id, created_at);
create index if not exists chat_messages_unread_idx  on public.chat_messages (user_id, sender, read);

-- Le backend utilise la clé service_role (accès complet) — RLS non requis côté serveur.
alter table public.chat_messages enable row level security;

-- ACCÈS DATA API EXPLICITE (24/09) — Supabase cesse le 30/10/2026 d'accorder automatiquement
-- l'accès aux NOUVELLES tables du schéma public. Sans ce GRANT, une restauration vers un nouveau
-- projet créerait une table que le serveur ne pourrait ni lire ni écrire (« permission denied »).
-- Le desk n'y accède QUE par la clé service_role (côté serveur) : on n'ouvre rien à anon ni à
-- authenticated — aucune lecture directe depuis un navigateur, par construction.
grant select, insert, update, delete on public.chat_messages to service_role;
