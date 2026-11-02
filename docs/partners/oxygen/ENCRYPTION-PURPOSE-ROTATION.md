# Oxygen encryption separation and rollout

Status: **unresolved before production enablement.** The current environment's
configured draft secret is used as raw AES key material by draft encryption,
phone handoff, general activation and the staging activation trial. Ordinary
response and payment-recovery evidence already derive a response-specific key
with HKDF. Separate AAD binds records to context, but it does not separate raw
keys, provide independent rotation or contain compromise of the shared secret.
Even deriving purpose-specific keys from the same root would not protect other
purposes when that root is compromised; independent rotation needs separately
provisioned secrets and an explicit key-retention policy.

New trial evidence retains bounded payment completion flags, the matching loan
reference, activation status and finite numeric terms instead of arbitrary raw
provider bodies. The existing trial encryption envelope and key are unchanged;
the decrypted evidence payload has changed, and any external/manual reader
that expects a `body` field must be updated. Existing stored trial evidence is
not rewritten or removed. General activation currently still encrypts the full
provider body; its separate minimization and evidence-recovery requirements
remain open.

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
