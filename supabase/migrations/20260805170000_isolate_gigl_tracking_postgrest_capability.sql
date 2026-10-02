-- Grant authenticator membership LAST, after the request-scope hook was
-- installed and activated by
-- 20260805113000_restore_gigl_tracking_postgrest_capability.
--
-- Why the sleep below: PostgreSQL exposes this new membership at commit
-- while PostgREST reloads configuration asynchronously, so granting
-- immediately after the restore commit leaves a race where an issued
-- worker JWT could invoke PUBLIC-granted RPCs without the five-path
-- restriction. The reload cannot be OBSERVED before granting: the hook
-- is a transparent no-op for every other role, and the worker role is
-- unassumable until this grant commits, so no Data API response
-- distinguishes loaded from unloaded. The 15s grace (orders of
-- magnitude above normal reload latency; this migration runs once)
-- closes the race in practice, and the post-migration live scope probe
-- fails the capability smoke -- blocking the cutover latch -- if the
-- reload never lands at all. Never move this grant earlier, where a
-- later failure would leave the token unconfined, and never reinstall
-- the hook here.
SELECT pg_sleep(15);
GRANT gigl_tracking_worker TO authenticator;
