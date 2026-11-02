# GIGL tracking provider token cache

The scoped GIGL tracking cron can reuse the provider login token across runs. It stores a bounded token record under `$HOME/baci-workers/gigl-tracking-token-cache/token.json`; the cache directory and file must be owned by the worker and have modes `0700` and `0600`, respectively. The cron's existing `gigl-tracking.lock` serializes normal invocations. Unsafe paths or cache errors fall back to provider authentication.

The worker installation must create and secure `$HOME/baci-workers` before the cron runs. The cache creates only its final directory; if the worker parent is missing or unsafe, the poller falls back to provider authentication until the installation is repaired.

Manual poller runs must acquire the same `gigl-tracking.lock` used by cron. Calling the TypeScript script directly without that lock can race a cache update and cause an extra provider login; cache-file operations do not implement their own cross-process lock.

The cache is bound to the configured provider URL, email, and password. Changing any of these invalidates the cached record. Tokens past their recorded expiry are not reused, and provider rejection continues through the existing refresh path. Do not put the cache file or its contents in logs, diagnostics, support bundles, or source control.

Treat `token.json` as password-equivalent, not merely as an expiring bearer token: its fingerprint permits offline password guesses if the file is exposed. Exclude it from backups and diagnostic exports, restrict access to the worker account, and rotate the provider password as well as the token if the file is exposed.

After an approved rollout, verify directory ownership and permissions without printing file contents, then compare provider login counts over successive polling intervals and after a controlled credential rotation. A passing local test or a merged PR does not establish the live provider behavior.
