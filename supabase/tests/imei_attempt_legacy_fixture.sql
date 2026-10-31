-- Legacy rows deliberately include two older unresolved attempts and a newer
-- completed report for the same owned fingerprint. No wallet operations occur.
INSERT INTO public.imei_lookups(id, customer_id, merchant_id, tier, imei_hash, idempotency_key, amount_ngn, status, cached_response, cached_status, created_at)
VALUES
('70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('b',64),'80000000-0000-4000-8000-000000000001',700,'pending',NULL,NULL,'2026-01-01'),
('70000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('b',64),'80000000-0000-4000-8000-000000000002',700,'pending_provider',NULL,NULL,'2026-01-02'),
('70000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('b',64),'80000000-0000-4000-8000-000000000003',700,'completed','{"success":true}',200,'2026-01-03');
