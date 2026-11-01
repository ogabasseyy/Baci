# Anonymous offer authority scope (#3746)

Guest cart validation reads each requested product's `merchant_id` from the normal public catalog client, groups offer IDs by that owner, and invokes the authority separately per merchant. A malformed/missing owner on a returned product fails verification; a missing product stays invalid. No client-provided tenant value grants authority.

Native discovery and offer-stock reads use `CONFIG.MERCHANT_ID`. Invalid or absent configuration returns a failed discovery lookup (`null`) and a retryable stock-check error; it never falls back to a cross-merchant read. Configured batches use the existing 1000-ID merchant-scoped cap.

Production blog callers in `cached-data.ts` and `live-blog-post.ts` both pass the resolved merchant UUID. The optional low-level hydration helper now fails soft, or throws with `throwOnError`, before any offer RPC when that context is unavailable. Agentic pricing and checkout replay pass their required merchant context through `prepare-agentic-offer-economics.ts` and `resolve-idempotent-offer-replay.ts`; their existing regression suites verify scoped arguments.

The append-only SQL repair preserves the installed authority signature, allocation logic, grants and batch caps. NULL-merchant mode is allowed only for authenticated/service-role contexts. Anonymous and absent caller contexts receive `merchant_scope_required` before any catalog projection. The canonical SQL suite verifies scoped anon plus privileged unscoped access; the native guard fixture executes the actual repair and existing cap preamble with catalog projection stubbed out.

No production migration or provider activation is part of this change.
