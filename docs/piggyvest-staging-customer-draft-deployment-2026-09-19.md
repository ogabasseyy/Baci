# Rejected Vercel customer-draft artifact proposal

## Status

Unshipped. Do not run this finalizer against a deployment artifact or deploy the resulting output. It has no proof that replacing the independent Vercel receiver with the full Next webhook preserves the receiver's distinct durable-store contract, environment binding, or raw-body HMAC behavior. The parent rejected this deployment design; the locally tested finalizer source remains unshipped only as a record of the rejected approach.

## Scope

This is an owner-run staging-only deployment plan for these existing Next handlers:

- `GET` and `POST` `/api/storefront/customer/savings/drafts`
- `GET` and `POST` `/api/storefront/customer/savings/drafts/policy`
- `GET` `/api/storefront/customer/savings/drafts/catalogue`
- Existing `GET` and `POST` `/api/webhooks/piggyvest`

The draft routes retain their existing authenticated RLS client, Zod parsing, CSRF protection for writes, runtime pins, and synthetic-merchant restriction. The webhook remains the existing Next route; this plan does not replace it with a new receiver or alternate authentication service.

## Artifact finalizer

`apps/web/tools/piggyvest-staging/prepare-customer-savings-draft-staging-artifact.ts` runs only against an already produced `.vercel/output` directory. It requires the four exact function directories above, rejects every nonempty cron configuration, preserves the generated Next routing and middleware, and prepends a 404 route for every path outside the four allowlisted endpoints. It never reads environment variables, credentials, or network state.

The focused test covers the allowlist insertion, required-function failure, and cron rejection:

```bash
pnpm --filter @baci/web exec vitest run tools/piggyvest-staging/prepare-customer-savings-draft-staging-artifact.test.ts
```

## Owner-run sequence

1. Use an approved clean VPS checkout at the reviewed commit. Do not build on the Mac and do not use `vercel build`, a Vercel cloud build, or the production `baci` project.
2. Run the focused draft, route, webhook, and artifact-finalizer tests, plus the required web lint/typecheck gates. Resolve or record unrelated pre-existing failures separately.
3. Have the owner-approved VPS prebuilt producer create a full Next `.vercel/output` artifact. A handwritten conversion from `.next` to Build Output API is not permitted.
4. Run the finalizer against that artifact before any upload:

```bash
pnpm --filter @baci/web exec tsx \
  tools/piggyvest-staging/prepare-customer-savings-draft-staging-artifact-cli.ts \
  "$PWD/.vercel/output"
```

5. Inspect the resulting `config.json`: its first route must be the finalizer's deny rule, the original generated routes must remain after it, and `crons` must be absent or empty. Confirm all four `.func` directories exist.
6. The parent may then link only the dedicated staging project and run the repository-approved prebuilt upload command, ending with `vercel deploy --prebuilt --prod`. Do not attach production domains, run database migrations, change DNS, or alter project environment values in this task.
7. After parent deployment, verify from an ordinary client that the six allowed method/path pairs preserve their expected auth and CSRF behavior, the webhook retains its existing GET/POST behavior, and representative denied paths return 404. A successful deploy does not prove hosted login, savings draft persistence, funding, provider processing, or production readiness.

## Deployment blockers

There is no authorized command in this task that creates a full Next `.vercel/output` artifact: `vercel build` and cloud builds are prohibited, while a normal Next build does not itself produce the Vercel Build Output API directory. The parent must provide or explicitly authorize an existing VPS prebuilt producer before step 3; this finalizer cannot replace that producer.

The repository-root `vercel.json` declares four cron routes, so a root-based full-app artifact will fail finalization exactly as intended. `apps/web/vercel.json` declares `crons: []`, but the parent must prove that an approved VPS prebuilt producer can build that monorepo root without falling back to the repository configuration, Vercel build, or a cloud build. Until that proof exists, the staged full-Next deployment is blocked.

The current staging project is a standalone webhook artifact. Promoting a full Next artifact to that project requires a separate owner audit of every build-time and runtime variable. The draft handlers need only the exact staging Supabase URL, matching public anon-key fingerprint, and server-only `PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED=true` to pass their runtime gate, but the full Next artifact and existing webhook can import additional configuration. No production, service-role, provider, or unrelated application secret may be copied to make that build succeed. If the necessary isolated staging configuration cannot be proven, the deployment must remain blocked.

The application runtime gate supplements the installed hosted SQL binding; it does not replace its exact database, cluster, merchant, user/customer, and `hosted_draft_visible` checks. The parent must re-verify that independent binding before enabling a staged artifact.
