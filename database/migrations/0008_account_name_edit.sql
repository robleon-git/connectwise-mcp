-- Account display metadata only. No authority, identity or billing columns are writable.
GRANT UPDATE(name) ON public.accounts TO cw_control;
