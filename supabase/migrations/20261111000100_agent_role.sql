-- 016a: new account role for sales agents / brokers. A new enum value must be committed
-- before anything can use it, so it lives alone in this migration.
alter type public.app_role add value if not exists 'agent';
