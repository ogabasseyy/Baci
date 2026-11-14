# Background build finalization: implementation contract

Status: **design under development; no worker is deployed or qualified**.

The current `build_experience` queues an `experience_jobs` row, but
`finalize_experience_build` performs the sandbox work synchronously. Two builds,
prerender, and up to twelve serial browser captures can exceed both the
300-second MCP backend deadline and the Next route's configured `maxDuration`.
Vercel terminates a function that exceeds its configured limit; its
[`waitUntil` and `after` work remains subject to that limit](https://vercel.com/kb/guide/troubleshooting-inconsistent-logs-in-vercel-functions).

## Chosen direction

Run durable work in the existing dedicated builder service on Contabo, not in
an unawaited Vercel invocation. Return an owner-bound job identifier promptly
and read its durable status through the existing `get_experience_operation`
tool. A process restart must not lose the job, and a client disconnect must not
be treated as evidence of cancellation or failure. Use the existing offline
runner and independent verifier; no model provider call is required.

OpenAI's [async function calling documentation](https://developers.openai.com/api/docs/guides/async-tool-calling)
describes application-owned execution in the Responses API; it does not itself
run our worker or prove that ChatGPT plugins support that feature. MCP's
[tasks extension](https://tasks.extensions.modelcontextprotocol.io/seps/2663-tasks-extension)
provides protocol-level task polling when negotiated, but ChatGPT support for
this app has not been established. The initial contract must use ordinary MCP
tools and may add the extension only after real-host compatibility is verified.

## Required engineering boundaries

1. Preserve and enforce the initiating connection, grant version, merchant,
   job and exact source binding in authenticated admission and every later
   claim/effect. `experience_jobs` already stores `connection_id` and
   `grant_version`; the actor is resolved through the connection. Existing
   Local, undeployed migrations now bind queue replay, claim, failure,
   cancellation, retry and finalization to the original connection and grant
   version. Synthetic two-connection regressions reproduced the gaps and pass
   after these changes. The entire lifecycle still needs a complete race review
   before worker admission.
   Do not infer authority from a merchant ID or let a privileged worker choose
   one. Define idempotency and tenant-bound status projection with normal
   RLS/RPCs.
2. Make worker admission atomic and bounded across processes. An expiring lease
   needs an unguessable attempt/fencing token, bounded concurrency and retry
   limits. An older worker must be unable to finalize or mark failed after a
   replacement claim, cancellation, revoke, or source/version change.
3. Resolve a current user-scoped session from the authorized connection, verify
   user identity and grant, and recheck authorization at each privileged effect.
   The broker must not acquire general commerce-table or service-role access.
   Define what happens when the user session expires or refresh becomes
   indeterminate; do not replay uncertain mutations blindly.
4. Execute the same independent build, digest, sandbox, capture and performance
   checks. Persist stage/result and retained renderer binding before reporting
   completion. Preview, apply and publish remain distinct owner-authorized
   actions. Existing unqualified performance results must stay unqualified.
5. Handle crash before claim, during sandbox work, after evidence recording,
   after durable finalization and before response. Test duplicate admission,
   competing workers, expired leases, revoke, cross-merchant access, stale
   attempt completion, worker restart and shutdown. Include a slow synthetic
   build exceeding the HTTP deadline without increasing that deadline.
6. Prove the actual ChatGPT host can start a job, observe pending/completed or
   failed state, recover after a disconnected response, and preview the exact
   result. Test within the requested synthetic/no-order/no-payment boundaries.

The existing linked edit runner is a useful reference for enumerating scoped
connections and obtaining user tokens. It is not a ready-made build worker:
build jobs, credentials, leases and verified output have different contracts.

## Local progress

The candidate now includes a normal-user `experience_list_due_builds` RPC for
up to 20 unexpired queued job IDs bound to one active connection and merchant.
A separate explicit single-job discovery tick resolves the linked user and
passes one job to an injected executor. A local adapter rechecks the canonical
grant, resolves a user-scoped client, and invokes the existing finalizer using
the job ID as its stable idempotency key. Local synthetic tests cover this
composition, connection isolation,
revocation, role denial, invalid expiry and user mismatch. Production-start
source can schedule the discovery worker when explicitly configured; its
background setting defaults to disabled and has not been activated or
qualified in production.

Each worker starts at most one build per tick. Ticks are scheduled every five
seconds, but a running tick suppresses later ticks until that build finishes;
the five-second interval is therefore not a five-second per-build throughput
guarantee. The cursor advances past the serviced connection and wraps after an
empty page. A synthetic test covers traversal across 23 continuously
backlogged connections, including the page boundary and wrap. It does not
establish real-world queue latency, fairness across processes, or capacity.
Measure and qualify those properties before admitting production traffic or
raising concurrency.
Local SQL now supports recovery of stale leases with a fresh attempt nonce,
three automatic recoveries, a terminal failure after exhaustion, and a
user-authorized lease-renewal RPC. The linked build supervisor now renews its
lease, stops on uncertain renewal and rechecks before evidence and finalization;
the finalization RPC also rejects an expired linked lease atomically.
Lease-renewal waits now time out after 30 seconds and remain failed even if a
late response succeeds; the regression covers a request that never settles.
The timeout bounds the worker's wait but does not itself cancel network I/O.
Disposable PostgreSQL tests cover competing claims, stale finalize/fail attempts and the
retry limit. Opt-in builder-host wiring starts and stops the worker and makes
MCP finalization return job status; the default remains off. On 14 November,
the synthetic local new-merchant journey passed through queued background
build, independent gVisor verification, finalized status and private preview
in 298.57 seconds. A read-only check of that disposable job observed the lease
renew during execution. Its identity provider and client adapter are synthetic,
the preview has no real catalog bootstrap, and this is not a ChatGPT host,
production deployment or checkout proof. Real-build crash recovery, shutdown
and production review remain required before activation.

A separate local PostgreSQL/PostgREST test uses two composed workers and one
synthetic merchant connection. It simulates a stalled first worker by expiring
its lease, lets the second recover and claim the job, then verifies the first
attempt cannot change the second attempt's running status. Its finalizer is
simulated, and both workers run in one test process; it is not an OS-process
crash/restart or real build-output recovery test.

A further local test starts two separate worker processes sequentially against
disposable PostgreSQL and PostgREST with a synthetic user token. It kills the
first process after it claims a job, expires the lease in the fixture, and
verifies that the replacement claims with a new attempt and records a terminal
result under RLS. Its finalizer is simulated; it does not prove recovery of a
real sandbox build or retained output, nor production process supervision.

The local candidate also reports an unfinished job past its 24-hour deadline
as `expired` using the database clock, rather than leaving it apparently queued
or running forever. A new authenticated, invoker-RLS read returns the status
and retained finalized build in one database statement. Disposable PostgREST
tests cover expired queued/running jobs, an active job, a finalized job after
its deadline, cross-owner denial and anonymous denial. This migration and the
matching application change remain unreviewed and undeployed.
