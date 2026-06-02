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
