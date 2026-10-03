-- Grant authenticator membership LAST, after the request-scope hook was
-- installed by 20260805113000_restore_gigl_tracking_postgrest_capability
-- AND observed fleet-wide by probe-gigl-hook-reload.sh (the deploy runs
-- the applier only through the restore, requires a unanimous window of
-- anonymous reload-canary acks over the Data API while re-signaling the
-- reload, then applies the rest): PostgreSQL exposes this new membership
-- at commit while PostgREST reloads asynchronously, so an unwitnessed
-- grant would leave a race where an issued worker JWT could invoke
-- PUBLIC-granted RPCs without the five-path restriction. The 15s grace
-- below is residual cover, not the gate itself: the unanimous window is
-- what proves convergence, and the grace absorbs a replica that reloads
-- between the last probe and this commit (this migration runs once).
-- Never move this grant earlier, where a later failure would leave the
-- token unconfined, and never reinstall the hook here.
SELECT pg_sleep(15);
GRANT gigl_tracking_worker TO authenticator;
