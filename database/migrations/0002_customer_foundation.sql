-- Slice 1 only. Runtime remains unable to create schema, roles or migrations.
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  display_name text,
  contact_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY,
  name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  acquisition_source text NOT NULL DEFAULT 'web' CHECK (acquisition_source IN ('web','substack','referral','manual','partner')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.account_memberships (
  user_id uuid PRIMARY KEY REFERENCES public.users(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  role text NOT NULL CHECK (role = 'owner'),
  UNIQUE (account_id,user_id)
);
CREATE TABLE public.external_identities (
  provider text NOT NULL CHECK (provider = 'microsoft'),
  tenant_id uuid NOT NULL,
  object_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  PRIMARY KEY (provider,tenant_id,object_id),
  UNIQUE (provider,user_id)
);
CREATE TABLE public.auth_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (account_id,user_id) REFERENCES public.account_memberships(account_id,user_id)
);
CREATE INDEX auth_sessions_expiry ON public.auth_sessions(expires_at);
CREATE TABLE public.auth_login_attempts (
  state_hash char(64) PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_login_attempts_expiry ON public.auth_login_attempts(expires_at);
CREATE TABLE public.entitlements (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  source text NOT NULL CHECK (source IN ('trial','web_paid','substack','comp')),
  status text NOT NULL CHECK (status IN ('active','expired','canceled','suspended')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX entitlements_one_trial ON public.entitlements(account_id) WHERE source='trial';
GRANT SELECT,INSERT ON public.users,public.accounts,public.account_memberships,public.external_identities,public.entitlements TO cw_control;
GRANT UPDATE(display_name,contact_email) ON public.users TO cw_control;
GRANT SELECT,INSERT,DELETE ON public.auth_sessions,public.auth_login_attempts TO cw_control;
GRANT UPDATE(revoked_at) ON public.auth_sessions TO cw_control;
