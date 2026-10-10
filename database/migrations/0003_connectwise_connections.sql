-- One current connection per account; pending rows are durable cleanup locators, never active credentials.
CREATE TABLE public.connectwise_connections (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id),
  server_url text NOT NULL,
  company_id text NOT NULL,
  public_secret_ref text,
  private_secret_ref text,
  status text NOT NULL CHECK (status IN ('persisting','connected','cleanup_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz NOT NULL,
  CHECK (server_url ~ '^https://' AND length(server_url)<=2048),
  CHECK (length(company_id) BETWEEN 1 AND 100),
  CHECK ((status='connected' AND public_secret_ref IS NOT NULL AND private_secret_ref IS NOT NULL) OR
         (status<>'connected' AND public_secret_ref IS NULL AND private_secret_ref IS NULL)),
  CHECK (public_secret_ref IS NULL OR public_secret_ref ~
    ('^https://monotorr-cw-creds-kv\.vault\.azure\.net/secrets/cw-connection-' || id::text || '-public/[a-f0-9]{32}$')),
  CHECK (private_secret_ref IS NULL OR private_secret_ref ~
    ('^https://monotorr-cw-creds-kv\.vault\.azure\.net/secrets/cw-connection-' || id::text || '-private/[a-f0-9]{32}$'))
);
GRANT SELECT,INSERT,DELETE ON public.connectwise_connections TO cw_control;
GRANT UPDATE(status,public_secret_ref,private_secret_ref,updated_at) ON public.connectwise_connections TO cw_control;
