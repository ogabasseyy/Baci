# Oxygen encryption separation and rollout

Status: **unresolved before production enablement.** The current environment's
configured draft secret is still used as raw AES key material by the default v1
draft and phone-handoff writers, general activation and the staging activation trial. Ordinary
response and payment-recovery evidence already derive a response-specific key
with HKDF. Separate AAD binds records to context, but it does not separate raw
keys, provide independent rotation or contain compromise of the shared secret.
Even deriving purpose-specific keys from the same root would not protect other
purposes when that root is compromised; independent rotation needs separately
provisioned secrets and an explicit key-retention policy.

## Phone-handoff independent-key candidate

Phone-handoff readers also support `v3`, using a separately provisioned 32-byte
hex secret named `OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY` or
`OXYGEN_PRODUCTION_PHONE_HANDOFF_ENCRYPTION_KEY`. New writes use v3 only when
the corresponding `OXYGEN_STAGING_PHONE_KEY_V3_WRITE` or
`OXYGEN_PRODUCTION_PHONE_KEY_V3_WRITE` is exactly `true`; defaults remain
unchanged. A missing, malformed, or legacy-root-equal v3 key fails closed.
Version, workflow, application, environment and capability hash remain bound as
authenticated data; v1 and v2 reads continue to use the original root.

Do not enable v3 writes until every serving instance can read v3 and the
independent key is provisioned consistently. Operators must provision distinct
staging and production secrets and keep them distinct from every other purpose;
the application only checks against the current legacy root. Turning the flag off does not
convert v3 records; retain the v3 key and a v3-capable reader until all such
handoffs expire. The old root remains necessary for older envelopes. This
candidate does not independently rotate drafts or either activation ledger,
and does not constitute staging or production rollout approval.

## Draft and phone-handoff v2 implementation

Drafts (including residential-only drafts) and phone handoffs now support
reading both the existing `v1` envelope and a `v2` envelope. The default
writer remains `v1`; only the exact server-side setting
`OXYGEN_PURPOSE_KEY_V2_WRITE=true` selects `v2` for new records. Do not set the
flag until every serving instance and recovery reader runs the dual-reader
code. The flag does not affect the separately encrypted response, payment,
trial, or general activation evidence, whose `v1` database contracts remain
unchanged.

The v2 key uses HKDF-SHA256 with an empty salt, the existing 32-byte configured
root as input key material, and one of the fixed info strings
`oxygen:form-draft:v2`, `oxygen:residential-draft:v2`, or
`oxygen:phone-handoff:v2`. The version and existing owner/workflow/application
context are also authenticated. This separates derived purpose keys but does
not give independent rotation or protection against root-key compromise.

Rollout requires dual readers on every instance first, then confirmation that
no older code or operational reader needs newly written records before
explicitly enabling v2 writes. An old deployment cannot read v2 records;
turning off the flag only makes future writes v1 and does not convert existing
v2 ciphertext. Roll back only to a release with dual readers until all v2
records have expired or been migrated under an approved retention procedure.
Keep the existing environment-specific root secrets available for both
versions. No actual flag, key, database or deployment is changed here.

New trial evidence retains bounded payment completion flags, the matching loan
reference, activation status and finite numeric terms instead of arbitrary raw
provider bodies. The existing trial encryption envelope and key are unchanged;
the decrypted evidence payload has changed, and any external/manual reader
that expects a `body` field must be updated. Existing stored trial evidence is
not rewritten or removed. New general activation evidence stores the HTTP
status, whether the activation response matched, and a SHA-256 body digest;
it no longer stores the raw provider body. Existing records are not rewritten,
and external readers expecting the old `body` field must be updated.

Do not change key material in place. Drafts and phone handoffs already stored
with the current `v1` format require the original secret to remain readable.
Older deployed code cannot read a new ciphertext format, so a safe rotation must
include all of the following before enabling new writes:

1. Agree a versioned envelope and distinct, independently provisioned keys for
   draft, handoff, trial and general activation data. Pin purpose and context
   in authenticated data; never silently fall back across key purposes.
2. Deploy and verify readers that accept the existing format and the new format
   everywhere first, including recovery and operational readers. Preserve the
   old key for existing data and document its expiry and access controls.
3. Update and rollback-test database constraints and RPC contracts where they
   restrict evidence to `v1`, including the general activation and response
   evidence paths. Trial evidence uses a different JSON capture envelope.
4. Only after all active readers are compatible, enable new-format writes and
   verify staged issuance, recovery, restart and rollback without provider
   mutations. Keep existing activation uncertainty and idempotency fences.
5. Inventory data retention and external readers, migrate or expire old
   ciphertext under an approved procedure, and retire each old key only after
   no data or rollback deployment requires it. Do not delete existing evidence
   without an explicit retention decision.

No keys, flags, databases or deployed configurations were changed by this note.
