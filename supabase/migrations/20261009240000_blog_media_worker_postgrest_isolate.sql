-- Re-grant authenticator membership LAST, after the extended
-- request-scope hook was installed by
-- 20261009230000_blog_media_worker_request_scope AND observed
-- fleet-wide by probe-blog-media-hook-reload.sh (the deploy runs the
-- applier only through the scope migration, requires a unanimous
-- window of anonymous reload-canary acks over the Data API while
-- re-signaling the reload, then applies the rest): PostgreSQL
-- exposes this new membership at commit while PostgREST reloads
-- asynchronously, so an unwitnessed grant would leave a race where
-- an issued worker JWT could invoke PUBLIC-granted RPCs without the
-- two-path restriction. The 15s grace below is residual cover, not
-- the gate itself: the unanimous window is what proves convergence,
-- and the grace absorbs a replica that reloads between the last
-- probe and this commit (this migration runs once). Between the
-- scope migration (which revoked membership) and this commit, worker
-- cron calls fail closed and recover on the next run. Never move
-- this grant earlier, and never reinstall the hook here.
SELECT pg_sleep(15);
GRANT blog_media_sweep_worker TO authenticator;
