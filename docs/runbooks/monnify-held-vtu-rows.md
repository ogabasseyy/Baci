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

An automatic aging alert for this query is a follow-up (needs an owner
decision on the age threshold).
