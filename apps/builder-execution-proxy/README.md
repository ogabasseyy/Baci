# Baci builder execution proxy candidate

The proposed synthetic execution origin is
`https://baci-builder-output.ogabassey-ai.workers.dev`. Its registrable site
is `ogabassey-ai.workers.dev`, separate from Baci and Ogabassey merchant sites.
Sibling Workers share the account's cookie site, so this proxy forwards no
cookies or browser credentials and emits no cookies. The paired Baci delivery
change also sends `sandbox allow-scripts` on HTML responses, including direct
navigation. The Worker returns a gateway error if an HTML document lacks the
expected opaque sandbox policy. Deploy delivery and its matching public
verifier together. Real
Chromium and WebKit regressions verify that scripts, styles and embedded
messages still work while shared-domain cookie writes are blocked.

The Worker accepts only GET requests for the existing preview resource and
published output contracts. It streams output from the fixed HTTPS Contabo
origin `builder-output-origin.usebaci.com`, preserves the delivery security
response headers, and refuses redirects. It omits Origin for published output. The Contabo
delivery listener still checks preview tickets and liveness, published
build binding, browser Origin and normal RLS. The Worker holds only the
origin authentication secret.

The preview delivery listener is the authoritative origin allowlist. It
rejects origins outside its configured hosts and permits the opaque
`Origin: null` used by sandboxed asset requests. The Worker admits private requests with no Origin or the sandbox Origin
`null`, and only forwards an opaque CORS grant for an opaque request.
Published assets are deliberately public. The edge accepts at most one
canonical published route parameter of up to 1,024 characters. The
published listener normalizes the decoded `path` through
`normalizeExperiencePath` before rendering, rejecting malformed encoding,
empty or dot segments, and characters outside its route grammar. It adds
the sandbox policy to document responses. Keep the Worker paired with that
listener and verify these behaviors during the live rollout checks.

Configure a dedicated 32-byte random base64url origin secret in the Worker
`EXECUTION_ORIGIN_KEY` binding and the Caddy service environment
`BACI_EXECUTION_ORIGIN_KEY`. Use the output-only Caddy vhost candidate. It
requires the secret before forwarding, strips credentials, and fixes the
upstream Host to the browser execution host. Only published index documents
can carry a query through Caddy. The Worker validates and serializes one
bounded route parameter, Caddy checks that canonical query, and the delivery
listener normalizes the route again. Set the builder service
execution origin to the same canonical Worker URL. This arrangement requires
a valid certificate and DNS-only record for the fixed upstream hostname so
the Worker no-store subrequest reaches Contabo directly. The runtime environment placeholder keeps the origin key out of adapted
Caddy JSON. Protect the service environment and keep the log filter enabled.

### Origin failure checks

The Worker is the browser-facing entry point and the canonicalizer for
published route queries. Caddy's output vhost is the authenticated Worker
upstream. Its query allowlist requires the uppercase escapes produced by the
Worker, so direct requests with lowercase escapes can return 404.

Use a known synthetic output URL to check the pair after configuring or
rotating the origin secret. A missing or malformed Worker binding returns
503 without reaching Contabo. An unset or mismatched Caddy secret returns 404,
which the Worker preserves. Treat 404 on the known probe as a reason to check
both secret bindings and the route, using the secret references and sanitized
service health. Never log or compare secret values in the probe output.

The Worker discards upstream error bodies and headers. It preserves 404 and
503 and maps other unexpected statuses, including upstream 401, 403 and 429,
to an empty 502. Use origin health and rate-limit metrics to distinguish
these cases from a transport failure. After rotation, verify the known probe
returns 200 before reopening preview traffic.

Wrangler disables Worker caching, invocation logs, traces, Logpush, and
version preview URLs. Both layers return `Cache-Control: private, no-store`.
The Worker uses a no-store upstream subrequest. Before sending any private
content, verify this exact deployment has no account-level Tail Workers,
log exports, traffic inspection or cached responses that could retain
preview tickets from URLs. Keep the candidate global Caddy runtime log filter when combining vhosts.
It removes full request headers and URLs from structured runtime errors.
The output vhost skips access logging even when the access logger is enabled.
The disposable HTTPS regression enables that logger and checks that the vhost
emits no access records. Verify all remaining Contabo sinks separately. Start with synthetic tickets and
verify they never appear in configured logs or instrumentation. Confirm plan
and usage before enabling traffic. This candidate uses one upstream
subrequest per file and requires no paid bindings.

## Local checks

```sh
node --test apps/builder-execution-proxy/worker.test.mjs
python3 apps/builder-execution-proxy/ingress.test.py
./node_modules/.bin/biome check apps/builder-execution-proxy
```

The checked-in Worker and Caddy candidate are local only. Production
certificate, DNS, secret, account observability and end-to-end browser
checks are still pending.
