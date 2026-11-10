# Wallet transaction PIN: enablement and emergency stop

The PIN store (migrations `20261102202600` to `20261102202603`, server helpers
`apps/web/src/lib/wallet-pin/wallet-pin-kdf.ts` and `wallet-pin-attestation.ts`)
ships dark. Turning it on takes three separate owner-approved steps. Do not
run any step against production without the owner's explicit approval for that
step.

The customer PIN functions can be called by any signed-in customer straight
through the Supabase API, so the database never trusts a hash it was handed.
Every set, change, reset and verify must carry an attestation: an HMAC the
server makes after it derives the hash, which the database checks with a key
only the migration owner can read (`wallet_pin_private.attestation_keys`). A
caller who picks their own hash cannot make one, and under a pepper with no
key row nothing works at all.

Prerequisites, in order: the PIN routes and the spend hold that consumes
proofs are merged and deployed with their own switches still off.

Pre-enable prerequisite: DONE. On top of the per-IP proxy limit, each signed-in
customer now has their own limit, charged after sign-in and keyed by merchant
and customer. Set and reset share 5 attempts per 10 minutes, change has its own
tighter 3 per 10 minutes (it runs two hashes), and the goal-PIN check has its
own 5 per 10 minutes. A limited request gets `RATE_LIMITED` (429) with a
`Retry-After` header. If Redis is unavailable these limits refuse the request
rather than allow it. The database lockout (five wrong PINs) still protects
each PIN. Customers sharing one carrier address no longer count against each
other here.

The PIN routes (storefront customer, signed in, merchant taken from the
server's primary-wallet configuration, never from the request):

- `GET /api/storefront/customer/wallet-pin/status` answers `primary`,
  `hasPin`, `resetRequired` and `available`. `available` is false while the
  pepper or attestation key is unusable or the merchant is switched off.
- `POST /api/storefront/customer/wallet-pin/set` sets the first PIN.
- `POST /api/storefront/customer/wallet-pin/change` changes it, given the
  current PIN.
- `POST /api/storefront/customer/wallet-pin/reset` replaces it after a recent
  sign-in.

Set, change and reset answer 503 `PIN_UNAVAILABLE` while the pepper or
attestation key is unusable. Status reports `available: false` in the same
situation, including when the pepper's attestation key row is missing or has
been deleted as an emergency stop. The per-IP limit is applied by the API
proxy: set, change and reset share 10 requests a minute per IP address (IPv6 clients are
counted per /64 block, not per customer), and status
reads have their own separate allowance. A limited request gets the proxy's
standard 429 response. A failed forgery check answers 403 `CSRF_FAILED`. Stable refusal codes: `PIN_INCORRECT` (401, with attempts left),
`PIN_LOCKED` (423), `PIN_NOT_SET`, `PIN_ALREADY_SET`, `PIN_RESET_REQUIRED`
(409), `REAUTHENTICATION_REQUIRED` (403). A PIN is never logged or returned.

## 1. Provision the pepper (server secret)

- Generate one random value of at least 32 characters, for example the output
  of `openssl rand -base64 48`. Never paste it into chat, tickets, logs or
  files in the repository.
- Before saving it, check its length on the machine that generated it (for
  example `printf %s "$value" | wc -c` must print 32 or more). Nothing later
  can check it for you: a Sensitive variable reads back blank, and the
  prebuilt build never sees its value.
- Store it as the Vercel **Production** server variable `WALLET_PIN_PEPPER`,
  marked Sensitive, through the REST API upsert (piping into `vercel env add`
  can store an empty value). It must never get a `NEXT_PUBLIC_` prefix, and it
  is deliberately not listed in `turbo.json`: it is read when a request
  arrives, never at build time. Then deploy through the approved VPS prebuilt
  flow.
- A missing, short or otherwise unusable value never breaks the site: it only
  keeps the PIN routes answering "unavailable" (503). If they still do after
  the deploy, the value is wrong; store a correct one and redeploy.
- **Do not rotate it.** Every PIN records which pepper made it. After a change,
  every customer gets "reset required" and must sign in again to set a new
  PIN. Rotate only as a planned event (for example after a suspected leak),
  with customer messaging ready, and provision the new pepper's attestation
  key (step 2) first.

## 2. Provision the attestation key (owner SQL)

The key is a one-way derivative of the pepper, so the database never holds
the pepper itself and its copy cannot be used to guess PINs. Derive it on the
machine that generated the pepper, in a shell with history off, from the same
value stored in step 1. The command prints one `INSERT`; it does not print
the pepper. Treat its output like a secret: do not paste it into chat,
tickets or logs, and run it as the migration owner straight away.

```sh
WALLET_PIN_PEPPER='<the value stored in step 1>' node -e '
const { createHmac } = require("node:crypto");
const pepper = process.env.WALLET_PIN_PEPPER.trim();
const mac = (label) => createHmac("sha256", pepper).update(label, "utf8").digest("hex");
console.log(`INSERT INTO wallet_pin_private.attestation_keys (pepper_id, attestation_key) VALUES (decode(\x27${mac("baci.wallet-pin.pepper-id.v1").slice(0, 16)}\x27, \x27hex\x27), decode(\x27${mac("baci.wallet-pin.attestation-key.v1")}\x27, \x27hex\x27));`);
'
```

The two derivations are the ones in `wallet-pin-kdf.ts` (`createPepper` and
`deriveWalletPinAttestationKey`); their unit tests pin the same values.

- Without this row every PIN action answers "unavailable", whatever the
  merchant switch says. Deleting the row is a second emergency stop for set,
  change, reset and verify; it does not touch proofs already issued.
- When the pepper changes (see step 1), insert the new pepper's row before the
  new pepper is deployed and delete the old row once no customer needs the old
  pepper's PIN. Until then the old row keeps old-pepper requests working.

## 3. Switch a merchant on (owner SQL)

PINs work only for merchants with an enabled authority row. Run as the
migration owner, after steps 1 and 2 are live:

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

Counts only. Never select salts, hashes, proof digests or attestation keys.

```sql
SELECT merchant_id, enabled, updated_at
  FROM wallet_pin_private.merchant_authorities;
SELECT pg_catalog.encode(pepper_id, 'hex') AS pepper_id, created_at
  FROM wallet_pin_private.attestation_keys;
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
- Setting the first PIN and resetting it both need a sign-in within 15 minutes
  on a live, unexpired session (password, an emailed or texted code or link, or an
  identity provider; an MFA step-up on an old sign-in does not count), and
  AAL2 when the customer has a verified MFA factor.
- A PIN belongs to the sign-in account and the merchant it was set for. If a
  customer row is ever pointed at a different account or merchant, that PIN
  and its unspent proofs stop working
  ("unavailable") and nobody can reset it through the app. Recovery is owner
  SQL after checking who the customer really is: delete that customer's row in
  `wallet_pin_private.customer_pins`, and the customer sets a new PIN.
- A proof is single use, valid 120 seconds, bound to customer, merchant,
  purpose, amount in kobo and the SHA-256 of the debit's Idempotency-Key, and
  spent only inside the hold transaction. A customer holds at most 10 live
  proofs.
- Every set, change, reset and verify carries the server's attestation for
  that exact caller, merchant, operation and request, at most two minutes
  old. A missing or malformed one is a bad request (22023); a wrong, stale or
  foreign one is refused (42501) before anything is stored, counted or issued.
- Clocks are read after locks: a lockout starts when the PIN row was actually
  obtained, a proof is judged expired by the time its row is held, a new
  proof is stamped after its purge finishes, and a reset judges the sign-in's
  age once it holds the PIN row.
- When a spend presents a proof, the reason is decided in this order:
  `missing`, `invalid`, `mismatch`, `used`, `expired`, `unavailable`. The
  binding comes before the proof's state, so `used` and `expired` describe
  only the debit the proof was issued for; a spent or expired proof shown for
  anything else is a `mismatch`. A refusal never spends a valid proof.
