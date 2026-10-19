# Legacy interest-capacity drafts: fixture only

These five unchanged SQL drafts were relocated from the release checkout's
top-level migration directory. They are not approved production migrations,
registered replay sources, deployment prerequisites, or authorization to apply
database or financial changes. The original takeover checkout is untouched.

Only explicit isolated test inclusion is permitted. The primary paid-interest
completion fixture includes `20261004200000` to model coexistence with a legacy
completion trigger. That fixture is not a production-schema replay or proof
that the broader legacy policy is approved.

## Scope exclusions

- `20261004200000` changes completion and backfills ledger-bound legacy goals
  beyond PRIMARY destinations. Global legacy completion needs separate product
  policy approval; PRIMARY-only authority cannot approve it.
- `20261004200100` is the event helper for the draft contribution replacements.
- `20261004200200` replaces the ordinary-wallet savings allocator, outside the
  production PRIMARY paid-interest bridge's scope.
- `20261004200300` replaces legacy plan-transfer allocation and is superseded
  chronologically by canonical later transfer migrations, including restricted
  destination handling. Do not apply it after those migrations.
- `20261004200400` changes legacy `prefunded_card` capacity, not the new PRIMARY
  card path. It is not implicitly approved by PRIMARY worker authorization.

Do not copy these files back to the top-level migration directory or register
them to make a production completeness check pass. Future production proposals
require separate owner review and append-only migrations preserving canonical
main behavior. No SQL policy or bytes changed during this relocation.

## Frozen SHA-256

| Version | SHA-256 |
| --- | --- |
| 20261004200000 | `8933ad76954b9ba90045748d831ed17ea6facda1ee80e85e80b489949be194ec` |
| 20261004200100 | `b69ca9e8e1f79ab645fa0ea5ec8081a6735e470f96af5a440c79dc88cd308374` |
| 20261004200200 | `29885aac2174533db14fad35d8bfb7dc9783fed664edb7b14f3aab607bea601f` |
| 20261004200300 | `701b5c8a466899139ff26683a4b16b0fc4a3b87cc827becd2297d9be0735ca31` |
| 20261004200400 | `f411cb32193650b4234e3bdba5c2bf10ada3f5d86cac5ad35598df35230032fe` |
