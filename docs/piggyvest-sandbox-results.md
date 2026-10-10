# PiggyVest sandbox evidence

Status: NOT RUN. Updated 12 September 2026.

Local TypeScript and synthetic SQL tests are not provider API tests. No credentials from the conversation have been provisioned or used by this implementation batch.

| Readiness layer | Current evidence |
| --- | --- |
| Local savings fixes | Targeted mobile/API/SQL checks pass, including completed-plan recovery navigation. See implementation progress for exact runs; full-suite and physical UI acceptance remain outstanding. |
| Local provider adapter | Read-only wallet/funding clients, provisioning request/dispatch and pure policy helpers pass synthetic tests. Disconnected from public financial routes; no live authentication evidence. |
| Outbound operation safety | Durable provisioning intents, exclusive first dispatch, private recovery references and uncertain-result handling pass local synthetic PostgreSQL tests. Provider resources have not been created or independently confirmed. |
| Database | Draft append-only safeguards; focused synthetic PostgreSQL testing does not prove the full Supabase replay or RLS environment. Nothing applied remotely. |
| Offline event processing | Bounded authenticated intake, durable private inbox, restricted SQL adapter and quarantine-only worker implemented locally. Restart, replay and concurrency checks pass; public endpoint remains unchanged. |
| Wallet/plan ownership | Immutable server-owned mappings and restricted lookup implemented locally. Cross-tenant, customer-binding and concurrent-provisioning checks pass; no real provider wallets mapped. |
| Deployed staging | Prior registration deployment is historical evidence in the original worktree; not reverified or changed in this batch. |
| Provider profiling | Separate provider confirmation required; endpoint HTTP success alone is not profiling acceptance. |
| Credentials | Test keys supplied previously; secure configuration and expected account identity remain activation prerequisites. Do not include key values here. |
| Financial sandbox validation | No customer/wallet creation, funding simulation, signed deposit processing, transfer, refund, schedule or interest test executed. |
| Production | Not authorized or certified. |

## Required before an activation request

1. Execute reviewed new migrations in an isolated faithful staging database with restricted intake/worker roles after approval. Exact pending-source hashes and the frozen-base smoke check pass locally; full database replay and RLS acceptance remain required.
2. Establish exact staging project/database and expected PiggyVest business identity; list only environment variable names and required permissions in the approval package.
3. Obtain a provider-signed financial sample, serialization rules and an outage/redelivery agreement. The earlier Hookdeck ping is not a PiggyVest financial event vector.
4. Establish units and field contracts for deposits, wallet balances, transaction finality, fees and interest payouts. Do not infer withdrawable/spendable balances from an unexplained number.
5. Specify synthetic identity fixtures, test-only funding simulation, operation caps and rollback/reconciliation steps. No real bank funding or KYC data.
6. Obtain owner approval for the exact deployment, secret provisioning and bounded provider test operations. None is implicitly authorized by local implementation approval.

## Provider questions still needed

The latest provider email could not be read: scoped Zoho searches returned Internal
Error twice on 12 September. These are verification gaps, not a claim that the
provider has not already sent the information.

- Please supply a successful deposit webhook with exact signed bytes and `x-pvb-signature`, using synthetic data; confirm whether signing uses received bytes or JSON reserialization.
- What happens when durable storage is unavailable: required response, automatic retry schedule, delivery retention and manual replay process?
- Please confirm amount units and mandatory fields for inflow/transaction/payout events and reads, with synthetic examples.
- Confirm test funding and identity fixtures, expected business identity, plan-wallet provisioning limits and settlement-wallet ownership.
- Before refunds/interest activation: confirm refund destination/options/fees, paid-interest reversal/attribution, and how internal transfers affect the per-wallet withdrawal counter.

## Unsent owner update

“We’re implementing and testing the savings integration, including exact device selection and transaction safeguards. We’ll confirm readiness after signed event delivery and end-to-end staging validation. Please share the signed financial-event sample and retry details so we can complete that validation.”
