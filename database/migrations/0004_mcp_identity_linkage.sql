-- Opaque Descope identities extend existing users; they do not create accounts or entitlements.
CREATE TABLE public.external_mcp_identities (
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  user_id uuid NOT NULL REFERENCES public.users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer,subject),
  UNIQUE (issuer,user_id)
);
CREATE TABLE public.mcp_link_attempts (
  state_hash char(64) PRIMARY KEY,
  session_hash char(64) NOT NULL UNIQUE REFERENCES public.auth_sessions(token_hash),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (account_id,user_id) REFERENCES public.account_memberships(account_id,user_id)
);
CREATE INDEX mcp_link_attempts_expiry ON public.mcp_link_attempts(expires_at);
GRANT SELECT,INSERT ON public.external_mcp_identities TO cw_control;
GRANT SELECT,INSERT,DELETE ON public.mcp_link_attempts TO cw_control;
GRANT UPDATE(state_hash,expires_at) ON public.mcp_link_attempts TO cw_control;
-- cw_mcp is created by the separately approved one-shot private bootstrap BEFORE this migration.
GRANT USAGE ON SCHEMA public TO cw_mcp;
GRANT SELECT ON public.schema_migrations,public.external_mcp_identities,public.account_memberships TO cw_mcp;
GRANT SELECT(id,status) ON public.users,public.accounts TO cw_mcp;
GRANT SELECT(account_id,source,status,starts_at,ends_at) ON public.entitlements TO cw_mcp;
GRANT SELECT(id,account_id,status,server_url,company_id,public_secret_ref,private_secret_ref) ON public.connectwise_connections TO cw_mcp;
