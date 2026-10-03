-- Grant authenticator membership LAST, after the request-scope hook was
-- installed by 20260805113000_restore_gigl_tracking_postgrest_capability
-- AND observed loaded by probe-gigl-hook-reload.sh (the deploy runs the
-- applier only through the restore, probes the hook's anonymous reload
-- canary over the Data API, then applies the rest): PostgreSQL exposes
-- this new membership at commit while PostgREST reloads asynchronously,
-- so an unwitnessed grant would leave a race where an issued worker JWT
-- could invoke PUBLIC-granted RPCs without the five-path restriction.
-- The 15s grace below is straggler cover, not the gate itself: the
-- canary ack proves at least one serving instance reloaded, and the
-- grace lets any slower replica converge before the grant commits
-- (this migration runs once). Never move this grant earlier, where a
-- later failure would leave the token unconfined, and never reinstall
-- the hook here.
SELECT pg_sleep(15);
GRANT gigl_tracking_worker TO authenticator;
