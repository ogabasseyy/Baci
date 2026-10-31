# Wallet transaction PIN: enablement and emergency stop

The PIN store (migrations `20261031224306` to `20261031224309`, server helper
`apps/web/src/lib/wallet-pin/wallet-pin-kdf.ts`) ships dark. Turning it on
takes two separate owner-approved steps. Do not run any step against
production without the owner's explicit approval for that step.

Prerequisites, in order: the PIN routes and the spend hold that consumes
proofs are merged and deployed with their own switches still off.

## 1. Provision the pepper (server secret)

- Generate one random value of at least 32 characters, for example the output
  of `openssl rand -base64 48`. Never paste it into chat, tickets, logs or
  files in the repository.
- Store it as the Vercel **Production** server variable `WALLET_PIN_PEPPER`,
  marked Sensitive. It must never get a `NEXT_PUBLIC_` prefix.
- Confirm it is set and non-empty (some CLI piping stores an empty value), then
  deploy through the approved VPS prebuilt flow. A set value shorter than 32
  characters fails the production build on purpose.
- **Do not rotate it.** Every PIN records which pepper made it. After a change,
  every customer gets "reset required" and must sign in again to set a new
  PIN. Rotate only as a planned event (for example after a suspected leak),
  with customer messaging ready.

## 2. Switch a merchant on (owner SQL)

PINs work only for merchants with an enabled authority row. Run as the
migration owner, after step 1 is live:

```sql
INSERT INTO wallet_pin_private.merchant_authorities (merchant_id, enabled)
VALUES ('<ogabassey merchant id>', true)
ON CONFLICT (merchant_id)
DO UPDATE SET enabled = true, updated_at = pg_catalog.clock_timestamp();
```

## Emergency stop

Switching a merchant off immediately stops PIN set, change, reset and verify
for its customers and refuses every unspent proof, so PIN-protected wallet
debits fail closed:

```sql
UPDATE wallet_pin_private.merchant_authorities
   SET enabled = false, updated_at = pg_catalog.clock_timestamp()
 WHERE merchant_id = '<merchant id>';
```

Stored PINs are kept; switching back on restores them.

## Read-only checks

Counts only. Never select salts, hashes or proof digests.

```sql
SELECT merchant_id, enabled, updated_at
  FROM wallet_pin_private.merchant_authorities;
SELECT merchant_id, pg_catalog.count(*) AS pins,
       pg_catalog.count(*) FILTER (WHERE locked_until > pg_catalog.now()) AS locked
  FROM wallet_pin_private.customer_pins GROUP BY merchant_id;
```

## Retention

Unspent proofs are deleted automatically: when they expire (on the
customer's next verify), when a new proof replaces them, and on every change
or reset. Spent proofs are kept as the record that a debit was approved with
the PIN; that is one small row per PIN-approved wallet debit. Decide a
retention period with the spend audit policy before high volume, and add
any cleanup as owner SQL or a scheduled job at that point.

## Rules the PIN store enforces

- Five consecutive wrong PINs lock for 30 minutes; each later lockout doubles,
  capped at 24 hours. A correct PIN or a reset clears the counters.
- Reset needs a sign-in within 15 minutes on a live session, and AAL2 when the
  customer has a verified MFA factor.
- A proof is single use, valid 120 seconds, bound to customer, merchant,
  purpose, amount in kobo and the SHA-256 of the debit's Idempotency-Key, and
  spent only inside the hold transaction. A customer holds at most 10 live
  proofs.
