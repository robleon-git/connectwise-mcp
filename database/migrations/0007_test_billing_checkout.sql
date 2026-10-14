-- Additive TEST Checkout reservations; migration 0006 and its restricted writer are unchanged.
CREATE TABLE public.billing_checkouts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.account_billing(account_id),
  mode text NOT NULL DEFAULT 'test' CHECK (mode='test'),
  stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_price_id text NOT NULL CHECK (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  stripe_session_id text UNIQUE CHECK (stripe_session_id ~ '^cs_test_[A-Za-z0-9]+$'),
  status text NOT NULL CHECK (status IN ('reserved','open','uncertain','complete','expired')),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_one_pending_checkout ON public.billing_checkouts(account_id) WHERE status IN ('reserved','open','uncertain');
ALTER TABLE public.billing_events ADD COLUMN stripe_checkout_session_id text CHECK (stripe_checkout_session_id ~ '^cs_test_[A-Za-z0-9]+$');
ALTER TABLE public.billing_events DROP CONSTRAINT billing_events_detail_category_check;
ALTER TABLE public.billing_events ADD CONSTRAINT billing_events_detail_category_check CHECK (detail_category IN ('unsupported_event','invalid_mapping','invalid_subscription','policy_review_required','billing_unavailable','lost_lease','checkout_pending'));
REVOKE ALL ON public.billing_checkouts FROM PUBLIC,cw_mcp;
GRANT SELECT,INSERT ON public.billing_checkouts TO cw_control;
GRANT UPDATE(stripe_session_id,status) ON public.billing_checkouts TO cw_control;
-- No entitlement privilege, function change, role creation, destructive data operation, or production application.
