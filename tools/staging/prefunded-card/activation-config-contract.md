# Prefunded first-card activation config

`activation-config-preflight.ts` accepts one owner-supplied JSON file and prints
only fixed prerequisite labels. The file must be a regular file owned by the
invoking user, with no group/world permissions, no symlink, and at most 128 KiB.
Use a private file outside the repository; never put it in `.env` or commit it.
The template is intentionally incomplete and contains placeholders, not default
identities or credentials.

The validator composes the existing background, first-card checkout and
recovery, saved-card public runtime, and receiver replay runtime schemas. It
requires their integration, merchant, treasury binding, business, physical
system, provider test credentials, public origins, callback and TLS connection
declarations to agree. It pins executor profiles and logins through the existing
schemas, the fixed database identity and expiry, all declared
database/project/host/port values, CA fingerprint, and passwords for each
repeated database login role.
Provider credentials and database passwords are retained only in the returned
server-side configuration; the CLI never prints values or raw parser errors.

The pass means the declarations are structurally consistent. It does not prove
that PostgreSQL is reachable over TLS, the CA or project identity is owner-authentic,
the source wallet is the treasury, treasury enrollment/binding is approved,
customer/goal mappings exist, any provider account or balance is suitable, routes
are deployed, workers are running, or a collection settled. The isolated compose
database currently has no host ports and uses its private network; raw PostgreSQL
TLS reachability still requires independent owner evidence. Enrollment proof,
treasury identity selection and any balance decision remain outside this tool.
This config does not install objects, seed funds, enable checkout, or initiate
provider requests. Collection is not PiggyVest settlement.

Run from `apps/web` after replacing every `<...>` value with securely supplied
owner evidence. The template is deliberately invalid until every placeholder is
replaced with a correctly typed value or object:

```sh
cd apps/web
chmod 600 /path/to/owner-only-activation-config.json
NODE_OPTIONS=--conditions=react-server pnpm exec tsx ../../tools/staging/prefunded-card/activation-config-preflight.ts /path/to/owner-only-activation-config.json
```

The exact accepted origins, executor profile semantics, scope schema, TLS
requirements and deadline remain defined by the referenced application schemas.
The customer allowlist, source wallet ID, DB endpoint, project identity, CA,
restricted login passwords, and provider credentials require owner proof; the
template does not fill them from observed provider balances or account names.
