# Held Monnify VTU rows (`monnifyOutcomeUnresolved`)

Since PR #4401, a Monnify answer that does not prove nothing was delivered
(pending, code 99, 408, 409/duplicate, 5xx code, unnamed vend state) leaves the
VTU row in `processing` with `metadata.monnifyOutcomeUnresolved = true`. It is
never refunded and never sent to Kuda automatically.

## Two kinds of held row

| Row has `metadata.monnifyVendReference` | Who settles it |
|---|---|
| Yes | The processing reconciliation requeries Monnify and settles it (success, or refund on an explicit FAILED). No action needed unless it stays `processing` for hours. |
| No | Nothing can requery it (Monnify resolves requery only by its own vendReference). Support settles it by hand. |

## Find rows waiting for support

```sql
select id, merchant_id, type, amount, request_reference, created_at, updated_at,
       now() - created_at as age,
       metadata->>'monnifyHeldTokenSeen' as token_seen,
       metadata->>'providerResponseCode' as provider_code
from vtu_transactions
where status = 'processing'
  and metadata->>'provider' = 'monnify'
  and metadata->>'monnifyOutcomeUnresolved' = 'true'
  and coalesce(metadata->>'monnifyVendReference', '') = ''
order by created_at;
```

## Settle one by hand

1. Search Monnify's dashboard (Bills Payment transactions) for the row's
   `request_reference`.
2. Delivered: mark the row successful through the normal support tool and
   leave the wallet alone.
3. Not delivered / reversed: refund through the normal wallet refund, then mark
   it failed. Never refund before Monnify confirms.
4. Not found at all after a day: treat as not delivered, same as step 3, and
   note the Monnify check in the row's support notes.

Check this query at least once a day. Rows older than 24 hours (`age`, from
`created_at`: `updated_at` is bumped by every reconciliation pass) are the ones
to settle first. An automatic alert for this query is a follow-up PR.

## Wording decisions (kept fail-closed)

- On a requery, `reversed` / `declined` alone do not prove the vend failed: the
  row stays held until support confirms in Monnify's dashboard. A fresh vend
  that Monnify plainly declines (no pending/duplicate/reference signal) is a
  refusal and is refunded.
- 401/403 login rejections are refunded even if the body shows a vend status
  (owner decision 2026-11-18).
- An HTTP 5xx status is retried with the same request reference, which Monnify
  dedupes; a duplicate answer on the retry is held.

## A held row that Monnify already issued a token for

A `PENDING` answer that already carries a voucher token but no Monnify
vendReference is held without storing the token (a processing row must not
carry a voucher, or it would never settle or notify). When settling such a row
by hand, open the transaction in Monnify's dashboard by `request_reference`:
if a token was issued, deliver it to the customer and mark the row successful;
only refund when Monnify shows the vend failed or was never created.
Rows with `token_seen = 'true'` (any held answer that carried a real token) are
the ones to settle first: Monnify issued a voucher. The token itself is never
stored on the row.

## Decision log

- 401/403/429 answers are refunded (owner decision 2026-11-18), with one
  exception added in PR #4401: an answer that also carries a real voucher
  token is held, because the voucher was delivered.
- A re-check (requery) that is refused with 401/403/429, or with login wording,
  stays put (processing) even if its body says `vendStatus FAILED`: a login
  rejection proves nothing about the vend. It is retried by the next
  reconciliation pass; if it keeps failing, settle it by hand like any held row.
  (A fresh vend with those codes is refunded: owner decision 2026-11-18.)
- A token that is exactly a placeholder word (`TEST`, `DUMMY`, `PENDING`,
  `TBD`, `N/A`, runs of `0`/`x`) is treated as "no token". If support sees a
  vend held because the token was one of those words, Monnify really did issue
  that value: deliver it and mark the row successful.
