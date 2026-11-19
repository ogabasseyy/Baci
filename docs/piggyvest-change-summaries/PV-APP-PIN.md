# PV-APP-PIN: Wallet PIN settings screen (mobile storefront)

## What changed

Customers whose PiggyVest main wallet is ready get a new **Settings > SECURITY > Wallet PIN** row. It opens a Wallet PIN screen with three forms, chosen by the server's PIN status:

- No PIN yet: "Set a wallet PIN" (New PIN, Confirm PIN, Save PIN).
- PIN set: "Change your PIN" (Current PIN, New PIN, Confirm new PIN, Change PIN) plus a "Forgot your PIN?" button that switches to reset.
- Reset required, or chosen via "Forgot your PIN?": "Reset your PIN" (New PIN, Confirm PIN, Reset PIN).

## Who sees it

Nobody on the legacy wallet. The row and the screen show only when both are true:

1. The PiggyVest primary wallet snapshot is `ready` with an account.
2. `GET /api/storefront/customer/wallet-pin/status` returns `primary: true` and `available: true`.

Any other answer, or any failed call, counts as off: the row is absent, and opening the route redirects to Settings without sending a PIN request. Calls are pinned to the signed-in user and late answers after an account switch are discarded.

## Server rules to know

- Setting a first PIN and resetting a forgotten one need a sign-in from the last 15 minutes. Otherwise the server answers `REAUTHENTICATION_REQUIRED` and the screen asks the customer to sign out and sign in again (with a confirmation before signing out).
- The shared storefront API client keeps only `.code` and `.message` of a server error. The attempts-remaining count and the lock-until time are therefore not shown; the server's own message is shown as-is.
- The app never claims a PIN can be recovered by support or email.

## PIN handling

PINs live only in component state and the request body. Fields are cleared after every submit, when the screen loses focus and on unmount. A PIN is never logged, stored, put in a URL or parameter, sent to analytics, or included in an error message. Requests are never retried automatically, and a single in-flight guard stops double taps.

## Files

- New `change` call: `lib/wallet-pin-change-api.ts`, `schemas/wallet-pin-change.ts` (strict `{currentPin, newPin}`, response `{ok: true}`).
- Gate: `components/settings/use-wallet-pin-settings-gate.ts`.
- State: `components/settings/use-wallet-pin-settings.ts`.
- UI: `WalletPinSettingsScreen.tsx`, `WalletPinField.tsx`, `SettingsWalletPinSection.tsx`, route `app/settings/wallet-pin.tsx`.
- `app/settings/index.tsx`: one added line rendering `<SettingsWalletPinSection />`.
- Every new wallet file has a sibling `*.server-off.test.tsx` for the storefront release gate.
