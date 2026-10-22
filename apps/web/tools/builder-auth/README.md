# Baci builder account linking

Separate, inactive merchant-broker implementation. It does not register tools in
Muse, the buyer MCP, or either submitted app. Importing `runtime.ts` starts no
server. The dashboard connection page is disabled by a static release gate.

## Local verification

From the repository root:

```sh
pnpm --dir apps/web/tools/builder-auth install --ignore-workspace --frozen-lockfile
pnpm --dir apps/web/tools/builder-auth typecheck
pnpm --dir apps/web/tools/builder-auth test
pnpm --filter @baci/web exec vitest run src/lib/builder-connector
```

The isolated package pins the Task 1 accepted OAuth provider/client. Docker tests
create only disposable local PostgreSQL, Supabase Auth and PostgREST containers.
They use synthetic accounts and delete their owned containers. A local HTTPS
fixture permits its own self-signed certificate; production uses normal TLS.
Node may emit a module-type detection warning when loading the existing shared
HTML escaping utility. No TLS downgrade or global certificate bypass is used.

## Authority and storage

- `createBuilderAuthRuntime` requires the private `baci_builder_auth_storage`
  role, separate signing/vault/cookie credentials, a fixed issuer/resource,
  a predefined outer client with its exact approved callback, and a dedicated
  upstream confidential client. Dynamic registration and CIMD remain disabled.
- The upstream authorization-code/PKCE transaction has independent state,
  nonce, verifier and callback. Its subject must match `auth.getUser()`.
  Consent binds current ownership, explicit create permission and scope.
  A changed target after the consent page is displayed requires a new flow.
- Provider models and pending transactions are AES-GCM encrypted. Bearer lookup
  IDs are hashed. Upstream tokens are separately encrypted and authenticated
  against actor, connection and key ID. Old decrypt keys support rotation.
- PostgreSQL is the canonical connection and provider store. Refresh uses a
  distributed advisory lock and a durable started marker. An interrupted or
  indeterminate exchange requires reconnect; credentials are never rolled back
  or retried blindly. The backend rechecks canonical status after renewal.
- OAuth revoke, refresh replay and Baci disconnect commit the same canonical
  revocation/version row. Owner management uses normal session authentication
  and SECURITY INVOKER/RLS RPCs; it cannot read vault/provider records.
- `createBuilderAuthenticator` validates ES256 `at+jwt`, issuer, resource,
  expiry, subject and version, then hydrates current consent from the canonical
  row. Token/user metadata cannot grant merchant authority. User clients use the
  dedicated upstream bearer and `getUser()`; they never fall back to cookies.

**Vault risk:** the dedicated upstream session has the linked user's normal RLS
rights. Compromise of this trusted backend/vault can exceed builder scopes.
Builder scopes constrain the broker and execution gateway, not the underlying
Supabase user's database session. Never return that bearer to MCP/browser code.
The original builder token is rejected by the upstream Data API.

## Release gates and next integration

The migration is source only and has only run on disposable fixtures. Do not
expose `builder_authorization` through PostgREST. Provisioning login credentials,
secrets, DNS/TLS, the real upstream OAuth setting/client and exact Platform
callback requires owner authorization. Existing submissions are not clients for
this service. Do not turn on the dashboard flag or mount this runtime as an
implied deployment step.

Task 4 must create/complete a private merchant and bind its target in the same
business transaction under RLS, keeping the pre-consented grant version only
for that materialization. The current SQL trigger defines that binding guard;
its standalone fixture is not the future create RPC. Recheck live grant/scope/
owner inside every mutation. Task 6 must wire the private runtime into the new
fixed execution gateway, with throttling, redacted audit and protocol challenges.
Task 9 owns full release replay, real staging/ChatGPT journeys and packaging.

Expired provider/transaction records are ignored on read. Release operations
must schedule bounded retention cleanup. Owner disconnect immediately stops
access via the canonical row; encrypted session cleanup may follow separately.
