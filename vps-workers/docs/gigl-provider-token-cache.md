# GIGL tracking provider token cache

The scoped GIGL tracking cron can reuse the provider login token across runs. It stores a bounded token record under `$HOME/baci-workers/gigl-tracking-token-cache/token.json`; the cache directory and file must be owned by the worker and have modes `0700` and `0600`, respectively. The cron's existing `gigl-tracking.lock` serializes normal invocations. Unsafe paths or cache errors fall back to provider authentication.

The worker installation must create and secure `$HOME/baci-workers` before the cron runs. The cache creates only its final directory; if the worker parent is missing or unsafe, the poller falls back to provider authentication until the installation is repaired.

The installed tracking wrapper takes a separate private cache lock and passes its descriptor to the worker. The worker verifies the lock, owning process and private file before using the cache; if verification fails, tracking proceeds without caching. Calling the TypeScript script directly without the wrapper therefore runs uncached. Concurrent calls within the same process also bypass the cache while another cache-enabled batch is running.

If the worker reports `token cache unavailable`, tracking continues without reuse. Inspect the cache directory and entry ownership, permissions and file type without reading token contents. An unsafe entry must be repaired by the worker operator while the tracking worker is stopped; remove or securely dispose of the entry only after confirming its identity and owner, then allow the worker to create a fresh cache. Never follow a symlink or include the file in diagnostics.

The cache is bound to the configured provider URL, email, and password. Changing any of these invalidates the cached record. Tokens past their recorded expiry are not reused, and provider rejection continues through the existing refresh path. Do not put the cache file or its contents in logs, diagnostics, support bundles, or source control.

The cache encrypts the token with AES-256-GCM using a per-record random salt and a key derived from the provider credentials with scrypt. An exposed record still permits offline password guesses, so treat the whole directory as password-equivalent. Exclude it, including temporary or `.stale` files left by interruption, from backups and diagnostic exports. Restrict access to the worker account, and rotate the provider password as well as the token if a record is exposed.

After an approved rollout, verify directory ownership and permissions without printing file contents, then compare provider login counts over successive polling intervals and after a controlled credential rotation. A passing local test or a merged PR does not establish the live provider behavior.
