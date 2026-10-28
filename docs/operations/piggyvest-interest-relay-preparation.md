# PiggyVest interest environment and relay preparation

This checklist prepares configuration and verification evidence only. It does
not activate interest processing, configure a provider, provision an environment
marker, or connect the relay to a webhook route. The live relay helper has no
production caller by design until receiver ownership and operational approval
are established.

## Per-environment interest readiness

Treat staging and production as separate databases and secret stores. Record the
verified project/environment identity before any owner performs provisioning.
Never infer it from a request, database name, URL, or integration row.

Before a deployment that serves interest data, the database owner must confirm:

- The append-only interest-history migration is applied and its
  `savings_interest_private.deployment_environment` row is set exactly once to
  the independently verified environment. The migration intentionally leaves
  this marker empty; without it earnings and history remain unavailable.
- The paid-interest inbox capture migration and the narrowly scoped evidence
  and worker grants are installed and verified in that same environment.
- The interest webhook secret belongs to the `interest` key family. If provider
  delivery will be directed to this endpoint, prove durable capture and drain
  with synthetic signed fixtures before changing provider routing.
- Verify the key PiggyVest will use to sign interest deliveries is configured
  for the `interest` family, and prove a synthetic payout signed with that key
  reaches durable capture. If the provider uses the same key for legacy and
  interest events, prove the verifier grants that key both families. A
  legacy-only configuration can return a retryable failure for interest. Keep
  existing provider routing until the applicable checks pass in that environment.
- Inbox creation and drain scheduling attestations match deployed receiver,
  worker role, and schedule state. Environment flags alone are not proof that
  those components are deployed.

The application must continue to fail closed while any item is missing. A
retryable response for an explicit interest payout is not durable evidence;
do not direct provider traffic to that path until the capture and drain drill
has passed. Keep the existing legacy path and key-family rules intact.

The checked-in Vercel configuration does not schedule a PiggyVest interest
capture or drain job (`apps/web/vercel.json` has no cron entries). A web deploy
does not establish worker or schedule readiness. Before traffic cutover, record
the separately managed scheduler/worker identity, enabled schedule, deployed
receiver and worker revisions, a successful synthetic capture-to-credit or
quarantine drill, and evidence that retries do not lose the captured delivery.
If no approved scheduler/worker is deployed, leave interest traffic on its
current route and keep the rollout blocked.

## Relay destination configuration

Relay configuration must provide both `receiverOrigin` and `endpoint`.
`receiverOrigin` is a separately reviewed HTTPS origin with no credentials,
path, query, or fragment. `endpoint` must use that exact origin and the fixed
`/piggyvest/intake` path. The relay rejects mismatches before attaching its
bearer token or forwarding signed bytes. Keep the token in server-only secret
storage; never put it in public environment variables, logs, or client code.

The origin value is a destination pin, not evidence of receiver approval or
reachability. Before any future wiring, independently verify ownership,
TLS, receiver authentication, durable acknowledgement semantics, timeout and
retry behavior, and an end-to-end synthetic capture/replay drill. Do not add a
live caller or enable provider delivery as part of preparation.
