# Comparison CPU follow-up to #3454

## Scope

- Reject exact decoded self-comparisons before inventory/model/detail loading.
- Index comparison specification sections and labels once, preserving the first
  duplicate's value, output order, missing-value markers, and difference flags.
- Share maintained comparison manifests by a durable merchant revision. This is
  lazy computation on the first request for a revision, not a background publisher.

## Cache correctness and rollout

The revision must change transactionally with the catalog invalidation enqueue.
It must not derive from the maximum of independent outbox target counters.
Every local snapshot used to fill the shared manifest includes the revision in
its cache key, including the category shell. This prevents an old process-local
snapshot from filling the new shared key after invalidation.

The public revision reader returns only a scalar for a published merchant, uses
the anonymous client, and bounds the read to a single attempt. It does not grant
access to the invalidation queue or introduce a service-role client.

An unavailable revision uses the existing local manifest path. Database errors
must not be converted into an authoritative empty shared manifest. The existing
page-model and product-detail cache freshness policies are unchanged.

The new migration must be deployed through the normal authorized release flow
before revision-keyed sharing is available. No production migration or deployment
was performed while preparing this change.

## Evidence boundaries

Focused tests cover self-pair early exit, normal comparison rendering, revision
propagation/failure, and specification output parity. The specification agent's
synthetic transformation benchmark reported 914.46ms before and 586.16ms after
for 2,000 iterations with two products and 24 sections of 16 specs each. This
excludes product-spec generation, database I/O, React rendering, and caching.
It is not a whole-request CPU measurement or a billing-savings forecast.

After deployment, compare Fluid CPU per comparison invocation and total daily
comparison CPU against a traffic-matched baseline. Retain price/stock, reversed
comparison, alias, and unpublished-store checks when evaluating the rollout.
