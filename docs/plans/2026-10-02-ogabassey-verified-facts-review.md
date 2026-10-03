# Agent-performed verified discovery facts research

Codex reads the catalog under normal RLS access, researches authoritative manufacturer evidence in batches, and saves confirmed facts through the authorized merchant session. The owner does not review products individually. No manual dashboard panel is included.

GET returns 20 merchant-scoped source records plus a pagination sentinel, existing raw metadata snapshots and conservative drafts. Query input is validated immediately after authentication. An optional merchantId is independently authorized by the existing merchant helper for both GET and PUT; it cannot bypass ownership, staff permissions or product scope.

Drafts preserve existing facts, propose exact category types or explicit stored type/model fields, and flag conflicting models. Descriptions, arbitrary numeric specifications and model-number lists are not proof. Variant facts remain option-local. Research evidence and unresolved conflicts must be retained separately; uncertain facts remain empty.

PUT replaces the full document and requires expectedRevision: an opaque SHA-256 computed by PostgreSQL over both existing discovery_metadata and name/category/metadata/specifications/mpn/color. The normal RLS reader returns source fields and the revision in a single MVCC statement; JavaScript never recomputes this digest. The SECURITY INVOKER writer compares that revision atomically; stale or inaccessible products return safe 409. JSONB numeric precision and Unicode identity therefore do not depend on JSON.parse or client echoes. No runtime caller requires legacy JSON snapshot guards; obsolete overloads are removed.

Affected API, schema and proposal tests plus web lint/typecheck are required. The new guarded-update migration must apply before the reader/writer deploy. No private environment edits or catalog mutations occur in this PR. Require exact-head CI and clean Codex review before merge, then verify deployed session reads and guarded writes. Fact coverage, semantic activation, MCP deployment, live relevance QA and app submission remain separate gates.

A guarded no-match intentionally conflates stale facts and inaccessible/deleted products; callers reload and reauthorize instead of using it as an existence probe.

The optimistic concurrency guarantee applies to this API and its guarded RPC, not every direct products-table writer. Existing tenant RLS and metadata CHECK constraints remain authoritative for direct Supabase writes. No global table-write restriction is introduced.

GET deliberately rejects unknown parameters; clients must use the documented cursor and merchantId fields. UUID traversal is not a transaction snapshot: inserts or deletes during a scan require a fresh full pass. Research uses a saved catalog snapshot, then repeats the catalog ID audit and freshly re-reads each product before guarded writes; coverage is claimed only for that reviewed set.

Writes no longer echo arbitrary JSON snapshots or recursively validate them. Drafts are deep-cloned so research edits cannot mutate the source context. Opaque revisions are bounded, strictly validated hexadecimal strings.

Research concurrency uses the shared private immutable revision function in additive migration 20261002233000. All three guarded migrations plus 20261003021500 must apply before deploying this API; the final reader/writer use only the lossless revision contract. The latest migration is retry-safe (conditional old-overload removal and CREATE OR REPLACE). Earlier immutable migrations retain their required predecessor assertions and must run in order, transactionally.

PUT retains the 96 KiB whole-body cap. With no JSON snapshot echoes, the request consists of a 64-character revision, UUIDs and the existing 16 KiB validated facts document. Stored source fields remain research context; unsupported numeric facts are never copied automatically. GET deliberately returns currentMetadata for research and expectedRevision for writes.

The research reader additionally requires the authenticated merchant owner or products/edit staff permission at the SQL boundary. Published catalog SELECT policies deliberately permit other shoppers; those public row policies alone cannot authorize merchant research RPCs. The additive reader authorization preserves storefront publication policies and normal invoker RLS.
