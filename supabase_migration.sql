-- ─────────────────────────────────────────────────────────────────────
--  Migration : abonnements à durée + blocage à l'expiration
--  À exécuter UNE FOIS dans Supabase → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────

-- Ajoute la date d'expiration de l'abonnement (NULL = illimité)
alter table public.users
  add column if not exists expires_at timestamptz;

-- (optionnel) index pour filtrer rapidement les abonnements expirés
create index if not exists idx_users_expires_at on public.users (expires_at);
