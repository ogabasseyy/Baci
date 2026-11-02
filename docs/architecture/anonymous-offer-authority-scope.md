# Anonymous offer authority scope (#3746)

Guest cart validation reads each requested product's `merchant_id` from the normal public catalog client, groups offer IDs by that owner, and invokes the authority separately per merchant. A malformed/missing owner on a returned product fails verification; a missing product stays invalid. No client-provided tenant value grants authority.

Native discovery and offer-stock reads use `CONFIG.MERCHANT_ID`. Invalid or absent configuration returns a failed discovery lookup (`null`) and a retryable stock-check error; it never falls back to a cross-merchant read. Configured batches use the existing 1000-ID merchant-scoped cap.

Production blog callers in `cached-data.ts` and `live-blog-post.ts` both pass the resolved merchant UUID. The optional low-level hydration helper now fails soft, or throws with `throwOnError`, before any offer RPC when that context is unavailable. Agentic pricing and checkout replay pass their required merchant context through `prepare-agentic-offer-economics.ts` and `resolve-idempotent-offer-replay.ts`; their existing regression suites verify scoped arguments.

The append-only SQL repair preserves the installed authority signature, allocation logic, grants and batch caps. NULL-merchant mode is allowed only when the database role setting is authenticated or service_role. PostgREST sets that role from the verified JWT; mutable claim GUCs alone cannot elevate an anonymous database role. A direct postgres or supabase_admin session without an explicit authorized `SET ROLE` is denied; callers can instead supply a merchant scope. The canonical SQL suite verifies scoped anon plus privileged unscoped access; the native guard fixture executes the actual repair and existing cap preamble with catalog projection stubbed out.

The repair injects the guard into the installed authority definition. Any later migration that replaces `get_storefront_offer_resolution` must retain the guard and run the anonymous NULL-scope checks after all migrations; `CREATE OR REPLACE FUNCTION` does not preserve the patched function body.

No production migration or provider activation is part of this change.
