# Ogabassey verified facts review

The discovery dashboard now loads a bounded merchant-scoped review page (20 products plus a pagination sentinel). Product editors see stored category, explicit type/model fields, source references and specifications alongside a draft facts document. No LLM enrichment or catalog writes run on load.

Drafts preserve existing facts and propose only missing exact category type or explicit metadata type/model. Conflicting model fields are flagged rather than arbitrarily selected. MPN/model-number lists, titles, descriptions, parent option specifications and generic numeric specs are not silently promoted to verified facts. Invalid existing documents remain visible for explicit repair.

The reviewer edits the complete JSON document, confirms source review, then saves one product through the existing authenticated/CSRF-protected PUT route. Edits clear the confirmation. The new optional expectedMetadata snapshot applies an atomic JSONB equality (or IS NULL) predicate alongside product and resolved merchant IDs; a stale or inaccessible product returns safe 409. Existing PUT callers without a snapshot retain their documented replacement behavior. GET requires product edit permission and never accepts a merchant ID from the caller.

This is a per-product review/import control, not an unattended backfill. Saving requires reliable merchant/supplier evidence and option consistency. Embedding coverage remains distinct from verified-fact coverage. Semantic search is unchanged and disabled until separate rollout approval and evaluation.

Validation: affected route/schema/proposal/panel/page tests; web lint and typecheck. No migrations or private environment changes are required. Deployment, authenticated browser QA and verified catalog writes remain separate rollout steps after PR review gates.
