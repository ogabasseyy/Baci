# Proposed verified-completion evidence contract — 12 September 2026

## Parent review request

This is the disabled REDVAULT successful-payment contract. Parent verified the current Paystack `GET /transaction/verify/:reference` documentation on 12 September: transaction status is `data.status`, and the response documents `data.reference`, `data.amount`, `data.currency`, `data.channel`, `data.domain`, `data.authorization.channel`, `data.authorization.brand`, `data.authorization.bank`, and `data.customer.email`.

## Normalized evidence required for approval

The trusted, server-only provider adapter must persist one immutable normalized evidence object per payment attempt. It must contain:

- `contractVersion`: `paystack_verified_card_v1`;
- `verificationSource`: `paystack_transaction_verify`, from a server-to-provider verification request, never browser callback metadata;
- `providerVerificationId`: provider-issued immutable verification/transaction identifier;
- `verifiedAt`: the stable provider `paid_at` timestamp returned by fresh verification, not the time the verification HTTP request ran;
- `reference`, `amountKobo`, and `currency`: exact values matching the frozen attempt, transaction, and order;
- `cardChannel`, `cardBrand`, and `issuerName`: verified `data.channel`, `data.authorization.channel`, `data.authorization.brand`, and exact `data.authorization.bank` values; and
- `acceptedFilterPolicyHash`: SHA-256 of the persisted accepted bank/card-filter policy attached to the attempt before initialization.

The adapter must reject an unsuccessful top-level API response, absent/contradictory evidence, non-card channels, unapproved brands, issuer-name mismatch, or customer mismatch. The exact issuer name comes only from separately validated server configuration and must be present in the policy persisted at initialization. It may not accept a caller-controlled boolean, requested filter metadata, a client-supplied issuer claim, PAN, BIN, `last4`, authorization code, or raw provider payload as proof.

## Database transition

The new `approve_and_complete_uba_redvault_payment` RPC is service-role-only and accepts this normalized evidence only after the capture receipt is held. Under the existing order lock it binds the immutable attempt, application, order, merchant, customer, reference, currency, amount, provider verification identifier, and policy hash; atomically marks the attempt/application approved, records one discount redemption, and transitions the order paid. A replay with identical evidence is idempotent; differing evidence or a conflicting paid order raises an error.

## Unvalidated external gates

- UBA/Paystack coverage and enforcement for the supplied ranges remain external evidence gates; the supplied values are coverage inputs only.
- Provider-side settlement/subaccount controls must be confirmed. The local `captured_held` state does not prevent external settlement.

Only synthetic local fixtures exercise the positive contract. Availability remains disabled, and no production caller is wired to emit `paystack_verified_card_v1` until parent integrates the interface and confirms remaining external gates.
