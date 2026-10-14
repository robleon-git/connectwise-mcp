-- TEST-mode foundation only. No live resources, credential roles or commercial enablement.
CREATE TABLE public.account_billing (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id),
  mode text NOT NULL DEFAULT 'test' CHECK (mode='test'),
  stripe_customer_id text NOT NULL UNIQUE CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text UNIQUE CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_price_id text NOT NULL CHECK (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  subscription_status text CHECK (subscription_status IN ('active','past_due','unpaid','canceled','incomplete','incomplete_expired','trialing','paused')),
  paid_activation_confirmed boolean NOT NULL DEFAULT false,
  current_period_start timestamptz CHECK (isfinite(current_period_start)),
  current_period_end timestamptz CHECK (isfinite(current_period_end)),
  cancel_at timestamptz CHECK (isfinite(cancel_at)),
  version bigint NOT NULL DEFAULT 0 CHECK (version>=0),
  lease_token uuid,
  lease_expires_at timestamptz CHECK (isfinite(lease_expires_at)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK (current_period_end IS NULL OR current_period_end>current_period_start)
);
CREATE TABLE public.billing_events (
  mode text NOT NULL DEFAULT 'test' CHECK (mode='test'),
  stripe_event_id text PRIMARY KEY CHECK (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.]{1,100}$'),
  event_created_at timestamptz NOT NULL CHECK (isfinite(event_created_at)),
  stripe_customer_id text CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  account_hint uuid,
  account_id uuid REFERENCES public.accounts(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processing','retry','processed','ignored','quarantined')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  detail_category text CHECK (detail_category IN ('unsupported_event','invalid_mapping','invalid_subscription','policy_review_required','billing_unavailable','lost_lease')),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL))
);
CREATE INDEX billing_events_pending ON public.billing_events(next_attempt_at,received_at) WHERE processing_status IN ('received','retry','processing');
CREATE INDEX billing_events_subscription ON public.billing_events(stripe_subscription_id);
REVOKE ALL ON public.account_billing,public.billing_events FROM PUBLIC,cw_mcp;
GRANT SELECT,INSERT ON public.account_billing,public.billing_events TO cw_control;
GRANT UPDATE(stripe_subscription_id,subscription_status,paid_activation_confirmed,current_period_start,current_period_end,cancel_at,version,lease_token,lease_expires_at,updated_at) ON public.account_billing TO cw_control;
GRANT UPDATE(account_id,processed_at,processing_status,attempts,lease_token,lease_expires_at,next_attempt_at,detail_category) ON public.billing_events TO cw_control;
-- Source-bounded writer runs as cw_migrator (existing schema owner), never PUBLIC or the MCP reader.
-- No role creation, broad entitlement UPDATE/DELETE grant, dynamic SQL, or selectable source.
CREATE FUNCTION public.apply_test_stripe_projection(
  p_account uuid,p_customer text,p_subscription text,p_price text,p_lease uuid,p_version bigint,
  p_status text,p_action text,p_paid boolean,p_start timestamptz,p_end timestamptz,p_cancel timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.account_billing%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.account_billing WHERE account_id=p_account FOR UPDATE;
  IF NOT FOUND OR b.mode<>'test' OR b.stripe_customer_id IS DISTINCT FROM p_customer OR b.stripe_subscription_id IS DISTINCT FROM p_subscription
    OR b.stripe_price_id IS DISTINCT FROM p_price OR b.lease_token IS DISTINCT FROM p_lease OR p_lease IS NULL
    OR b.lease_expires_at<=statement_timestamp() OR b.version IS DISTINCT FROM p_version
    OR p_status IS NULL OR p_action IS NULL OR p_paid IS NULL OR p_start IS NULL OR p_end IS NULL
    OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_start>statement_timestamp() OR p_end<=p_start
    OR (p_cancel IS NOT NULL AND (NOT isfinite(p_cancel) OR p_cancel<=p_start))
    OR p_status NOT IN ('active','past_due','unpaid','canceled','incomplete','incomplete_expired')
    OR p_action NOT IN ('activate','preserve','cancel')
    OR (p_action='activate' AND (p_status<>'active' OR NOT p_paid))
    OR (p_action='cancel' AND p_status NOT IN ('unpaid','canceled','incomplete_expired'))
    OR (p_action='preserve' AND p_status NOT IN ('active','past_due','incomplete'))
    OR (b.paid_activation_confirmed AND NOT p_paid)
  THEN RAISE EXCEPTION 'invalid_billing_projection' USING ERRCODE='22023'; END IF;
  IF p_action='activate' THEN
    INSERT INTO public.entitlements(id,account_id,source,status,starts_at,ends_at)
    VALUES(gen_random_uuid(),p_account,'web_paid','active',p_start,p_cancel)
    ON CONFLICT(account_id) WHERE source='web_paid' DO UPDATE SET status='active',ends_at=EXCLUDED.ends_at;
  ELSIF p_action='cancel' THEN
    UPDATE public.entitlements SET status='canceled' WHERE account_id=p_account AND source='web_paid';
  ELSIF b.paid_activation_confirmed AND p_cancel IS NOT NULL THEN
    -- Retry grace never extends a verified scheduled cancellation boundary.
    UPDATE public.entitlements SET ends_at=p_cancel WHERE account_id=p_account AND source='web_paid' AND status='active';
  END IF;
  UPDATE public.account_billing SET subscription_status=p_status,paid_activation_confirmed=p_paid,
    current_period_start=p_start,current_period_end=p_end,cancel_at=p_cancel,version=version+1,
    lease_token=NULL,lease_expires_at=NULL,updated_at=statement_timestamp() WHERE account_id=p_account;
END $$;
REVOKE ALL ON FUNCTION public.apply_test_stripe_projection(uuid,text,text,text,uuid,bigint,text,text,boolean,timestamptz,timestamptz,timestamptz) FROM PUBLIC,cw_mcp;
GRANT EXECUTE ON FUNCTION public.apply_test_stripe_projection(uuid,text,text,text,uuid,bigint,text,text,boolean,timestamptz,timestamptz,timestamptz) TO cw_control;
