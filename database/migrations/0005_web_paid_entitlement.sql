-- Reader compatibility only: one mutable paid grant, regardless of status.
-- Duplicate existing rows make this migration fail; never reconcile/delete customer grants here.
CREATE UNIQUE INDEX entitlements_one_web_paid ON public.entitlements(account_id)
WHERE source = 'web_paid';
