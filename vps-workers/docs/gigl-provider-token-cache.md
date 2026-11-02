# GIGL tracking provider token cache

The scoped GIGL tracking cron can reuse the provider login token across runs. It stores a bounded token record under `$HOME/baci-workers/gigl-tracking-token-cache/token.json`; the cache directory and file must be owned by the worker and have modes `0700` and `0600`, respectively. The cron's existing `gigl-tracking.lock` serializes normal invocations. Unsafe paths or cache errors fall back to provider authentication.

The worker installation must create and secure `$HOME/baci-workers` before the cron runs. The cache creates only its final directory; if the worker parent is missing or unsafe, the poller falls back to provider authentication until the installation is repaired.

The cache is bound to the configured provider URL, email, and password. Changing any of these invalidates the cached record. Tokens past their recorded expiry are not reused, and provider rejection continues through the existing refresh path. Do not put the cache file or its contents in logs, diagnostics, support bundles, or source control.

After an approved rollout, verify directory ownership and permissions without printing file contents, then compare provider login counts over successive polling intervals and after a controlled credential rotation. A passing local test or a merged PR does not establish the live provider behavior.
