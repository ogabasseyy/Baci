# PV-APP-BALANCE: the storefront app reads the PiggyVest main-wallet balance

## What changed

For a customer whose PiggyVest main wallet the server reports as ready:

- The wallet screen shows the PiggyVest balance (the server sends it in kobo; the app converts to naira in one place, `koboToNaira`).
- "Add to savings" moves money from that balance into the goal. It keeps the existing wallet PIN step.
- When the balance is too low, the customer is taken to "Add money" (the PiggyVest account number panel). They are never sent to a card payment (Paystack).
- While the "Add money" panel is open, the app refreshes the balance every 10 seconds for up to 5 minutes. When the balance goes up it shows "Money received".
- If PiggyVest answers "insufficient funds", the app says "Not enough money in your wallet" and keeps the same operation id (nothing moved).

How it is wired:

- `lib/piggyvest-primary-wallet.ts` and `lib/piggyvest-primary-capability.ts` now carry `balanceKobo` (null unless ready).
- `hooks/resolve-wallet-funding-account.ts`: the "ready" settlement carries `balanceKobo`. The post-fetch user-identity check is unchanged.
- `hooks/wallet-primary-balance.ts` (new) sets the additive field `WalletData.primary_balance_kobo` only for a ready wallet. The legacy `balance` and `total_balance` are never changed, because checkout and other legacy readers still use them.
- `derive-wallet-display-data.ts`: with `primary_balance_kobo` present, spendable = PiggyVest balance and total = spendable + savings. It also returns `primaryReady`.
- `WalletPrimaryContext` (new) tells the savings contribution flow that the wallet is ready, without changing the modal files owned by other work.
- To keep files under 300 lines, the primary-balance merge logic moved out of `wallet-data.ts`, and the goal callbacks moved out of `WalletScreen.tsx` into `wallet-screen-savings-goal-handlers.ts`.

## What is gated

All new UI and behaviour needs an explicit server "ready" answer (status `ready` with an account). Any other outcome gives exactly today's behaviour: `PIGGYVEST_NOT_READY`, a pending snapshot, a profile or review error, a failed or timed-out probe, or an account switch during the read. Those cases show the legacy balance and the Paystack "Continue to payment" path. A failed read never removes today's options.

## Rollback

Make the server answer "not ready" for the PiggyVest main wallet. The next wallet load drops `primary_balance_kobo`, and the app shows the legacy balance and card funding again. No app release is needed.

## Known caveats

- Checkout still spends the legacy balance (`wallet.balance`), not the PiggyVest balance.
- There is no PiggyVest transaction history in the app yet: the list still shows the legacy ledger.
- The total in the hero is PiggyVest balance plus goal savings.
