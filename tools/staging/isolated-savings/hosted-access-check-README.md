# Read-only hosted access checks

Run from the repository root:

```sh
node --input-type=module -e 'import {checkHostedAccess} from "./tools/staging/isolated-savings/hosted-access-check.mjs"; console.log(JSON.stringify(await checkHostedAccess()))'
node --test tools/staging/isolated-savings/hosted-access-check.test.mjs
```

The checker sends only six fixed GET/OPTIONS requests to
`https://staging-auth.ogabassey.com`. It does not load environment files, send
credentials, follow redirects, initiate login, create records or move funds.
TLS verification stays enabled. Response bodies are discarded, not logged.
Each request has a five-second timeout; network errors expose no error details.

Passing means the anonymous user route rejects access, admin/signup/unknown
routes are denied, and the synthetic draft route has the expected browser
preflight policy. It does **not** prove authenticated login, durable draft
processing, database isolation, application deployment, PiggyVest connectivity
or financial end-to-end success. `financialEndToEndVerified` always remains false.
A missing hostname, unavailable backend, wildcard CORS or redirect cannot pass.

On 15 September 2026 all six live checks were unavailable (no HTTP response).
The separate DNS check returned no A record. Four synthetic checker tests passed.
