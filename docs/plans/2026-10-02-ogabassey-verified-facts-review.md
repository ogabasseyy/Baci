# Agent-performed verified discovery facts research

Codex reads the catalog under normal RLS access, researches authoritative manufacturer evidence in batches, and saves confirmed facts through the authorized merchant session. The owner does not review products individually. No manual dashboard panel is included.

GET returns 20 merchant-scoped source records plus a pagination sentinel, existing raw metadata snapshots and conservative drafts. Query input is validated immediately after authentication. An optional merchantId is independently authorized by the existing merchant helper for both GET and PUT; it cannot bypass ownership, staff permissions or product scope.

Drafts preserve existing facts, propose exact category types or explicit stored type/model fields, and flag conflicting models. Descriptions, arbitrary numeric specifications and model-number lists are not proof. Variant facts remain option-local. Research evidence and unresolved conflicts must be retained separately; uncertain facts remain empty.

PUT replaces the full document. expectedMetadata is sent in a bounded RPC POST body; a SECURITY INVOKER function applies semantic JSONB equality (IS NOT DISTINCT FROM), including NULL, under existing product RLS; a stale or unavailable row returns safe 409. Existing callers retain optional snapshot behavior.

Affected API, schema and proposal tests plus web lint/typecheck are required. The new guarded-update migration must apply before the reader/writer deploy. No private environment edits or catalog mutations occur in this PR. Require exact-head CI and clean Codex review before merge, then verify deployed session reads and guarded writes. Fact coverage, semantic activation, MCP deployment, live relevance QA and app submission remain separate gates.

A guarded no-match intentionally conflates stale facts and inaccessible/deleted products; callers reload and reauthorize instead of using it as an existence probe.
