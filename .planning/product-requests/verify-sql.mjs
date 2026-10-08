import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE || '/tmp/baci-product-request-db/node_modules/@electric-sql/pglite/dist/index.js').href);
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE authenticator;
CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA cron; CREATE SCHEMA storefront_search_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, private TO anon, authenticated;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
CREATE TABLE public.merchants(id uuid PRIMARY KEY, slug text UNIQUE, is_published boolean, is_platform_admin boolean, user_id uuid REFERENCES auth.users);
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000001','ogabassey',true,false,'00000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002','draft-store',false,false,'00000000-0000-4000-8000-000000000001');
GRANT SELECT ON public.merchants TO authenticated;
CREATE TABLE public.notification_preferences(merchant_id uuid PRIMARY KEY, in_app_enabled boolean);
CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, message text, notification_type text, priority text, target_type text, target_merchant_ids uuid[], channels jsonb, created_by uuid REFERENCES auth.users, is_system boolean, scheduled_for timestamptz CHECK (scheduled_for IS NOT NULL), sent_at timestamptz, delivery_state text);
CREATE TABLE public.merchant_notifications(notification_id uuid REFERENCES public.notifications ON DELETE CASCADE, merchant_id uuid REFERENCES public.merchants, in_app_visible boolean, banner_visible boolean, UNIQUE(notification_id, merchant_id));
-- Model the existing platform audit boundary: customers cannot create notifications.
CREATE FUNCTION private.audit_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'platform_admin_notifications_manage_required'; END IF; RETURN NEW; END $$;
CREATE TRIGGER audit_notification AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.audit_notification();
CREATE TABLE cron.jobs(name text, schedule text, command text);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.jobs VALUES ($1,$2,$3) RETURNING 1::bigint $$;
`);
await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261002190000_storefront_product_requests.sql', import.meta.url), 'utf8'));
// Apply the shipped restriction so replay exercises the live grant path
// (storefront_intake-only EXECUTE), not the superseded service-role grant.
await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261004170500_restrict_storefront_product_request_intake.sql', import.meta.url), 'utf8'));
// Apply contact canonicalization so replay covers the shipped dedup/budget keys.
await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261008210000_storefront_product_request_contact_canonical.sql', import.meta.url), 'utf8'));
// Apply distinct outcome codes so replay pins the route's SQLSTATE contract.
await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261008220000_storefront_product_request_outcome_codes.sql', import.meta.url), 'utf8'));
await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261008230000_storefront_product_request_contact_intl_prefix.sql', import.meta.url), 'utf8'));
const submit = (query, contact, id, slug = 'ogabassey') => db.query('SELECT public.submit_storefront_product_request($1,$2,$3,$4::uuid)', [slug, query, contact, id]);
const id = (number) => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
await db.exec('SET ROLE anon');
await assert.rejects(submit('iPhone 20', 'shopper@example.com', id(1)), /permission denied/);
await assert.rejects(db.query('SELECT query, contact FROM public.storefront_product_requests'), /permission denied/);
await assert.rejects(db.query('SELECT private.deliver_storefront_product_requests()'), /permission denied/);
// The superseded service-role path stays denied after the restriction.
await db.exec('RESET ROLE; SET ROLE service_role');
await assert.rejects(submit('iPhone 20', 'denied@example.com', id(20)), /permission denied/);
await db.exec('RESET ROLE; SET ROLE storefront_intake');
await submit('iPhone 20', 'shopper@example.com', id(1));
await submit('iPhone 20', 'shopper@example.com', id(1));
await submit('iPhone 20', 'shopper@example.com', id(2));
await assert.rejects(submit('iPhone 20', 'other@example.com', id(1)), { message: /Request conflict/, code: '23505' });
await assert.rejects(submit('iPhone 20', 'shopper@example.com', id(3), 'draft-store'), { message: /Store unavailable/, code: 'P0001' });
await assert.rejects(submit('!!!', 'shopper@example.com', id(3)), /Invalid product request/);
await assert.rejects(submit('iPhone 20', '', id(3)), /Invalid product request/);
await assert.rejects(submit('iPhone 20', '-------', id(10)), /Invalid product request/);
await submit('iPhone 20', '+234 801 234 5678', id(11));
await submit('iPhone 21', 'shopper@example.com', id(4));
await submit('iPhone 22', 'shopper@example.com', id(5));
await assert.rejects(submit('iPhone 23', 'shopper@example.com', id(6)), /Request limit reached/);
// Canonical contact keys: punctuation variants of one phone share dedup
// suppression and the 3/hour budget; stored values keep shopper spelling.
await submit('iPhone 30', '+234 801 000 1111', id(30));
await submit('iPhone 30', '+234-801-000-1111', id(31));
await db.exec('RESET ROLE');
assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.storefront_product_requests WHERE id IN ('" + id(30) + "','" + id(31) + "')")).rows[0].count, 1);
await db.exec('SET ROLE storefront_intake');
// The 00 international prefix folds to the same key as + and suppresses.
await submit('iPhone 30', '00234 801 000 1111', id(35));
await db.exec('RESET ROLE');
assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.storefront_product_requests WHERE id IN ('" + id(30) + "','" + id(31) + "','" + id(35) + "')")).rows[0].count, 1);
await db.exec('SET ROLE storefront_intake');
await submit('iPhone 31', '+2348010001111', id(32));
await submit('iPhone 32', '+234 (801) 000-1111', id(33));
await assert.rejects(submit('iPhone 33', '+234801 0001111', id(34)), /Request limit reached/);
await db.exec("RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false)");
const customerRows = await db.query('SELECT query, contact FROM public.storefront_product_requests');
assert.equal(customerRows.rows.length, 0);
await assert.rejects(submit('iPhone 24', 'another@example.com', id(7)), /permission denied/);
await db.exec('RESET ROLE; SET ROLE storefront_intake');
await submit('iPhone 24', 'another@example.com', id(7));
await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)");
assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.notifications')).rows[0].count, 0);
assert.equal((await db.query('SELECT private.deliver_storefront_product_requests() AS delivered')).rows[0].delivered, 8);
assert.equal((await db.query('SELECT private.deliver_storefront_product_requests() AS delivered')).rows[0].delivered, 0);
assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.merchant_notifications WHERE merchant_id = $1', ['10000000-0000-4000-8000-000000000001'])).rows[0].count, 8);
assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.merchant_notifications WHERE merchant_id = $1', ['10000000-0000-4000-8000-000000000002'])).rows[0].count, 0);
await db.exec("SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false)");
assert.equal((await db.query('SELECT query, contact FROM public.storefront_product_requests')).rows.length, 8);
await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); DELETE FROM public.notifications");
assert.equal((await db.query('SELECT private.deliver_storefront_product_requests() AS delivered')).rows[0].delivered, 0);
await db.exec(`INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000003','limit-store',true,false,'00000000-0000-4000-8000-000000000001');
INSERT INTO public.storefront_product_requests(id,merchant_id,query,contact) SELECT gen_random_uuid(),'10000000-0000-4000-8000-000000000003','Product ' || i,'shopper' || i || '@example.com' FROM generate_series(1,50) AS i; SET ROLE storefront_intake`);
await assert.rejects(submit('iPhone 20', 'new-shopper@example.com', id(8), 'limit-store'), /Request limit reached/);
await db.exec("RESET ROLE; UPDATE public.merchants SET is_published = true WHERE slug = 'draft-store'; INSERT INTO public.notification_preferences VALUES ('10000000-0000-4000-8000-000000000002', false); SET ROLE storefront_intake");
await submit('iPhone 20', 'shopper@example.com', id(9), 'draft-store');
await db.exec('RESET ROLE');
await db.query('SELECT private.deliver_storefront_product_requests()');
// The earlier backlog occupies the first batch of fifty.
await db.query('SELECT private.deliver_storefront_product_requests()');
assert.equal((await db.query("SELECT in_app_visible FROM public.merchant_notifications WHERE merchant_id = '10000000-0000-4000-8000-000000000002'")).rows[0].in_app_visible, false);
// Privacy erasure: deleting a delivered request removes its inbox copy
// (notification + merchant link) while leaving other merchants untouched.
await db.exec("DELETE FROM public.storefront_product_requests WHERE merchant_id = '10000000-0000-4000-8000-000000000002'");
assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.notifications')).rows[0].count, 50);
assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.merchant_notifications WHERE merchant_id = '10000000-0000-4000-8000-000000000002'")).rows[0].count, 0);
assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.merchant_notifications WHERE merchant_id = '10000000-0000-4000-8000-000000000003'")).rows[0].count, 50);
await db.close();
console.log('SQL request validation, deduplication, contact rate limit, contact canonicalization, RLS, least-privilege intake (service role denied), worker-only delivery, recipient isolation, delivery replay and erasure propagation: passed. Cron scheduling is stubbed; live scheduler and push delivery are unverified.');
