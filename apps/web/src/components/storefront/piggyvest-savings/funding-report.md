# Funding presentation handoff

READY FOR PARENT REVIEW

## Owned new files

- `funding-details.tsx`: read-only `FundingDetails` component.
- `funding-details.types.ts`: exported serializable `FundingDetailsProps`.
- `funding-details.test.tsx`: colocated synthetic RTL coverage.
- `funding-report.md`: this local report.

All paths are in `apps/web/src/components/storefront/piggyvest-savings/`.
Existing status, theming, provider, schema, route and other agents' files were
not edited. No dependency was added.

## Exact final props

```ts
type FundingDetailsProps =
  | { status: 'loading' | 'pending' | 'unavailable' }
  | {
      status: 'ready';
      accounts: Array<{
        accountNumber: string;
        accountName: string;
        bankName: string;
      }>;
    };
```

This matches the coordinated server projection with an additional local loading
state. Parent can spread the server result into `FundingDetails`. Project only
the three sanitized display fields; never serialize raw provider objects or IDs.
Account numbers remain strings, preserving leading zeros. The card renders all
accounts in order with semantic description lists and a polite status message.
An empty ready array displays unavailable. React escapes text; the component
does not parse HTML or spread account data into DOM attributes.

The explicit notice in every state is: “Test environment only. Do not send real
money to these details.” The staging label is unconditional. There are no buttons,
links, inputs, clipboard operations, effects, HTTP requests, fee claims or money
movement. Existing merchant CSS-variable theming is reused unchanged. No new
client directive is required because the component has no interactivity.

## Customer-change integration obligation

The final contract contains no customer identity or request-generation token.
Parent must synchronously render loading/pending/unavailable when the active
customer changes, and discard responses belonging to the previous customer.
The component holds no state or cached account details: changing status removes
details immediately, even if stale accounts remain as extra props. A stale
`ready` response cannot be independently identified by this identity-free view.
Authentication, sanitization, account ownership and response freshness remain
server/parent adapter responsibilities. No page or route is connected here.

## Synthetic fixtures

Primary: `Synthetic Test Bank`, `Synthetic Account Alpha`, `0000000123`.
Secondary: `Synthetic Second Bank`, `Synthetic Account Beta`, `0000000456`.
All fixtures are invented; no provider calls or customer data were used.
Coverage includes all four states and notices, exact labels/leading zeros,
multiple accounts, stale-detail removal, customer loading/replacement, excluded
provider fields, escaped markup, empty ready arrays and JSON serialization.

## Validation and limits

TDD: all 13 initial final-contract assertions failed against a null-rendering
placeholder before implementation. Final validation: 14 synthetic RTL tests
passed; scoped Biome checked three TypeScript files with no errors. Runtime
component: 62 lines. No existing files were modified by this task.

Run from the worktree root:

```sh
pnpm --dir apps/web exec vitest run src/components/storefront/piggyvest-savings/funding-details.test.tsx
pnpm exec biome check apps/web/src/components/storefront/piggyvest-savings/funding-*
```

Only scoped tests and Biome are in scope. Parent owns root checks and typecheck.
Browser visual acceptance, server-adapter integration and provider sandbox
acceptance are not verified. Missing financial contracts still block their
affected money paths; this presentation implements none of those paths.
