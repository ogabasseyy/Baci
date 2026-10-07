# Plan-wallet names

The authenticated savings-funding path supplies the stored customer's name, not
a request-selected account label. New wallets send a readable `subaccount_name`
such as `Bassey Effiong Savings D4851B9412725E22`. The suffix is derived from the
integration and goal IDs, so two goals with the same customer name stay distinct.

Names are NFKC-normalized, whitespace-collapsed and bounded to 50 code points,
including the 16-character suffix. These are application choices, not claimed
PiggyVest length or character guarantees. The
[wallet contract](https://www.piggyvestbusiness.com/docs/api/wallet/create)
requires a unique wallet name. Provider acceptance of the new formatting still
needs a staging deployment and a newly provisioned test wallet.

## Existing accounts and retries

- An omitted `customerName` retains the exact legacy `baci` hash name and HMAC.
- A new-name request conflicting with an existing intent also checks the legacy
  request, changing only the name. Compatibility requires the same intent ID and
  a matching legacy fingerprint (`duplicate`), never a newly accepted intent.
- Pending legacy intents dispatch their original request bytes. Dispatched,
  uncertain and acknowledged intents are not posted again.
- Changes to financial settings or provider identity remain conflicts. A changed
  customer name after a new-format intent is prepared also remains a conflict;
  it does not rename an account or overwrite the journal.
- Names do not establish ownership: existing scoped mappings, claims and provider
  customer checks remain authoritative. No migration or balance update is needed.

The bank-facing account name remains the `account_name` returned by PiggyVest.
Do not synthesize a business prefix or replace it with our wallet label. The
wallet-header layout (number, copy icon and bank name) is unchanged.
