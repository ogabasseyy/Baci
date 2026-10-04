-- Run after the fixture AND the actual notification RBAC migration.
SET ROLE anon;
DO $$ BEGIN IF (SELECT count(*) FROM public.notifications) <> 0 THEN RAISE EXCEPTION 'Anonymous reader received contact'; END IF; END $$;
SET ROLE authenticated;
SET fixture.notification_admin='false';
SET fixture.user_id='owner';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.notifications) <> 1 THEN RAISE EXCEPTION 'Owner must receive only its delivered request'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE message LIKE '%owner@example.test%') THEN RAISE EXCEPTION 'Owner cannot follow up with customer'; END IF;
END $$;
SET fixture.user_id='authorized-staff';
DO $$ BEGIN IF (SELECT count(*) FROM public.notifications) <> 1 THEN RAISE EXCEPTION 'Staff access must be merchant scoped'; END IF; END $$;
SET fixture.user_id='unrelated';
DO $$ BEGIN IF (SELECT count(*) FROM public.notifications) <> 0 THEN RAISE EXCEPTION 'Unrelated user received contacts'; END IF; END $$;
SET fixture.notification_admin='true';
DO $$ BEGIN IF (SELECT count(*) FROM public.notifications) <> 3 THEN RAISE EXCEPTION 'Explicit notification administrator permission not honored'; END IF; END $$;
