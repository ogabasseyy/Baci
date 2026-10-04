# Replay worker handoff

This folder now contains a bounded, staging-only replay foundation. It decrypts the existing AES-256-GCM receipt shape, authenticates the AAD `piggyvest-staging:staging-v1:<payload_sha256>`, verifies the raw UTF-8 SHA-256 digest, validates the supported provider event schemas, and requires the leased event id and nested customer identity to agree.

The worker has no persistence implementation and does not construct a Supabase service-role client. `ReplayAdapters` must be backed by the durable receipt store for lease claim, claim-token-fenced resolution, mapping lookup, dispatch, and quarantine before activation. Quarantine must atomically and durably record the sanitized reason while fencing on the supplied claim token; a stale worker must not be able to quarantine after lease loss. Mapping lookup must resolve exactly `(provider customer, pvb_wallet)`; `eventData.destination_wallet_id` is not an attribution substitute and may differ legitimately.

The dispatch adapter must return only after its reviewed, idempotent financial effect or duplicate outcome is durable. The existing `processPiggyvestEvent` return value is not sufficient evidence: it returns `processed` after some poison failures that are resolved as failed. The adapter must translate that distinction explicitly.

No storage activation, secrets access, mapping rows, deployment, or external writes are included here. The main TypeScript configurations exclude `tools/piggyvest-staging`; run the focused Vitest files and an ephemeral targeted `tsc` project/check before activation. Parent-level lint, typecheck, test, and review gates remain required.
