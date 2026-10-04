-- Disposable test database only. Access helpers model explicit owner/staff grants.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.notifications(id uuid PRIMARY KEY, sent_at timestamptz, delivery_state text, message text);
CREATE TABLE public.merchant_notifications(notification_id uuid, merchant_id uuid);
CREATE TABLE public.fixture_merchant_access(user_id text, merchant_id uuid);
CREATE FUNCTION public.has_merchant_access(merchant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.fixture_merchant_access WHERE user_id=current_setting('fixture.user_id',true) AND merchant_id=merchant)
$$;
CREATE FUNCTION public.current_user_has_platform_admin_permission_v1(permission text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT permission='notifications.manage' AND current_setting('fixture.notification_admin',true)='true'
$$;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.notifications,public.merchant_notifications TO anon,authenticated;
INSERT INTO public.notifications VALUES
 ('00000000-0000-4000-8000-000000000001',now(),'sent','Product request: phone. Contact: owner@example.test'),
 ('00000000-0000-4000-8000-000000000002',now(),'sent','Foreign merchant contact'),
 ('00000000-0000-4000-8000-000000000003',NULL,'pending','Undelivered contact');
INSERT INTO public.merchant_notifications VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000020'),
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000010');
INSERT INTO public.fixture_merchant_access VALUES
 ('owner','00000000-0000-4000-8000-000000000010'),
 ('authorized-staff','00000000-0000-4000-8000-000000000010');
