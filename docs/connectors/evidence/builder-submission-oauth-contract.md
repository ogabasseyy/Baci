# Baci builder submission OAuth contract — pending qualification

On 14 November, a read-only check again found that
`https://mcp.usebaci.com/.well-known/openid-configuration` identifies the
upstream Supabase issuer, while the builder MCP protected-resource metadata
path returned HTTP 404. Neither response establishes the intended dedicated
builder OAuth connection. No deployment or submission was performed.

The same-merchant test must also respect an intentional distinction: the
unpublished owner preview uses an internally constructed simulated commerce
dispatcher and does not write a live cart. A checkout test using the real
commerce engine therefore needs a disposable synthetic public-serving fixture;
the local preview alone cannot prove that checkout path.

On 14 November, a combined disposable PostgreSQL test used a synthetic OAuth
account and MCP to create a merchant, inserted a product as its signed owner,
then queued and completed an offline gVisor background build and delivered its
private preview. It refreshed the short-lived MCP access token through the
local broker during the run. After the preview, the same database and same
merchant/product entered the Baci cart engine through the scoped shopper role,
added one item and prepared checkout. A delivery zone and rate were created by
the synthetic owner through RLS, and the anonymous merchant-rate projection
returned the expected fee in the merchant's currency. The orders table remained
empty. The
fixture enables shared-cart entitlement directly in the disposable database.
The preview is a simple generated page whose bootstrap is built by the actual
owner-preview bootstrap and catalog adapter using the owner's RLS client; the
test confirmed the product name appears in the delivered prerender. The local
fixture explicitly injects that bootstrap function into its verifier, capture
and preview wiring, and supplies a compact synthetic database schema; it is
not a deployed full-schema proof. The cart calls are direct scoped SQL,
not a shopper browser, final checkout UI or the
generated page driving checkout. OAuth's upstream user, PostgREST and runner
transport are local test adapters. This is not a deployed ChatGPT-host or full
storefront-to-final-checkout proof.

A follow-up short combined test used a loopback PostgREST listener and signed
scoped shopper tokens for the same merchant's cart operations and checkout
preparation, rather than direct SQL calls. It passed with the delivery quote
and an explicit order-insert denial. The full isolated-build rerun with this
HTTP path failed before reaching the cart, and its exact build failure has not
been established. A second attempt also failed and left one named test bundle;
the owned sandbox was absent from the runtime listing and that bundle was
removed. The Mac had a load average above 500 afterward; this may affect local
timing but does not establish the cause. The earlier full run used direct SQL,
so it must not be represented as a full HTTP-path pass.

A subsequent full local rerun passed with the loopback HTTP cart path included
after the actual offline background build and private preview. It used the
same synthetic merchant/product, normal signed shopper tokens, owner-RLS
shipping-rate creation, an anonymous rate projection and the order-insert
guard. The earlier failed reruns' cause remains unconfirmed. This passing run
does not establish a shopper browser, final checkout UI, live ChatGPT OAuth,
production deployment, or a complete production-schema replay.

A further full run uploaded and built synthetic custom source containing SDK
cart and checkout buttons, and passed the same private-preview, scoped HTTP
cart and shipping checks. The preview verification did not click those
buttons or connect that private frame to the live cart: private preview
commerce is intentionally simulated. Interactive shopper-browser validation
against the public storefront host remains outstanding.

A subsequent combined run used host Chromium, the actual Baci private
`ExperienceFrame` and locally intercepted preview resources to click the
generated page's add and checkout buttons. The simulated add succeeded and
the private frame did not present a real checkout. The same run separately
passed the signed HTTP cart and shipping checks. The host is a test page,
the private cart is simulated, and no browser action drove the real cart or
shipping route; this is not a public storefront-to-checkout result.

A subsequent local-only run seeded a synthetic public-read head for the same
finalized and independently evidenced build in the disposable database. The
real public delivery gateway returned its index and JavaScript before the
same-merchant cart and shipping checks passed. A later run also resolved the
same product through Baci's public experience runtime and anonymous catalog
policies, and checked a different owner could not read the private build job.
This seed is fixture data, not
an owner approval or publication operation; the database was discarded. No
shopper browser interacted with the public frame in this run.

Local cart-relay integration (2026-11-12): an opt-in test used the disposable
`serve-local` fixture, real storefront cart routes and its synthetic
PostgREST/Postgres scoped cart engine. The trusted session completed CSRF,
bootstrap, cart creation, one product add and checkout review; the test asserts
the exact request paths, with no order or payment request. The test adapter maps
a synthetic HTTPS origin to the local HTTP fixture and adds the `Secure` cookie
attribute to emulate production cookie handling. The fixture logged a degraded
local Redis quota store. This evidence does not qualify HTTPS, a browser, the
isolated runner's interactive channel, a live deployment or submission. The
fixture was stopped after the test.

A follow-up local test drove Chromium through the browser interception and
both sides of the bounded channel to the same real synthetic cart fixture. It
reached checkout review and confirmed an attempted order request was blocked.
The page was a controlled test document, Chromium ran on the host, and the
network adapter remained local HTTP. This does not prove a generated storefront
in gVisor, production TLS or the live ChatGPT connection. The fixture was stopped.

A separate disposable local gVisor qualification used the browser rootfs with
a read-only test-worker bind mount and `--network=none`. Chromium exchanged
synthetic cart requests over the host channel and rejected an order request.
The first attempt exposed an open stdin that prevented process exit; closing it
after the terminal frame fixed the failure. The rerun and job cleanup passed.
Responses were synthetic, the page was controlled, and this did not alter the
installed production runner or prove an actual storefront checkout there.

The disposable network-disabled gVisor test was subsequently extended to
create a synthetic cart, add the selected product and reach checkout review
through the local Baci cart routes and scoped Postgres fixture. It asserts the
exact request path sequence and blocks an attempted order request. This still
uses a controlled page and a local HTTP adapter, and does not prove a generated
storefront, production TLS, production runner deployment, or ChatGPT connection.
The fixture logged degraded local Redis quota storage and was stopped afterward.

An exploratory local browser run against generated Orbit identified the real
bridge's anonymous RLS product hydration request and cart continuity read. Once
the synthetic fixture's product read was allowed, Add to bag showed one item
at NGN 250. A subsequent checkout-review request began, but the browser closed
before it completed; this is not a checkout pass. An exact merchant/product
projection policy and the continuity allowance were added locally. At that
point the product policy was not yet wired to a transport or observer.

The local candidate now includes a pinned, anonymous-key-only transport for
the exact product projection, a host relay dispatcher and browser interception
for that request. Focused policy, transport and real-browser tests passed with
synthetic responses; the existing local gVisor checkout-review test also passed
after this change, without exercising the product read in gVisor. These pieces
are not installed in the production verifier service and do not prove the
generated Orbit journey in the sandbox or a live Supabase connection.

The disposable gVisor test was subsequently extended to read the selected
synthetic product through the same local anonymous/RLS PostgREST fixture before
creating the cart and reaching checkout review. The host held the fixture's
anonymous key; it was not passed to the sandbox. The exact selected-product
projection was enforced and an order request was blocked. This used a controlled
page and local adapters; it is not a generated-site, production TLS or live
ChatGPT proof. The fixture's temporary connection metadata was removed on stop.

A later disposable gVisor run replayed a captured local generated Orbit page,
its frame, assets and development WebSocket stream with `--network=none`. The
actual Orbit Add to bag and Review checkout interactions reached the synthetic
Baci cart review through the host channel and anonymous/RLS fixture; an order
request was blocked. The initial empty-cart probe required the fixed
`x-baci-cart-probe` header, now covered by regression tests. This is a local
development replay with a local HTTP adapter, not production TLS, production
runner installation, final checkout UI, shipping or live ChatGPT proof. The
fixture reported degraded local Redis quota storage and was stopped afterward.

The local public-verification coordinator now constructs its cart/product relay
from the owner-bound receipt, the anonymous/RLS-derived selected product and
the configured publishable key, and passes it to its trusted observer callback.
Focused tests and the disposable owner/anonymous RLS recorder test passed. The
observer callback and production verifier service remain uninstalled; this
composition alone does not permit publication or establish live readiness.

The local candidate now includes an interactive fixed-helper executor and
bounded worker start-frame reader. Local tests exercise a separate subprocess,
duplex cart requests, failure exit and cleanup failure. The `public-observe`
job is deliberately not registered in the production helper or ingress, and no
production worker or toolchain pin has been installed. This is plumbing evidence,
not a production observer or submission-readiness result.

The executor was subsequently exercised against the disposable local gVisor
job and the same synthetic anonymous/RLS product and cart fixture through
checkout review. A test-only adapter provided the helper's prepare/run/delete
operations; this did not register or install the production job. An interrupted
fixture left its synthetic metadata file behind, which was manually removed;
cleanup now occurs before dependent teardown and has a focused regression test.

The generated Orbit replay was also rerun through the interactive executor in
a disposable network-disabled gVisor job. It used the local anonymous/RLS
product and cart fixture, reached the checkout-review response and blocked an
order attempt. The helper lifecycle was provided by a test adapter and the
storefront used captured development assets, a replayed development WebSocket
stream and local HTTP; this does not qualify a production helper, TLS, shipping,
final checkout UI or ChatGPT submission. Temporary fixture metadata was removed.

This is a proposed configuration, not a submission-ready package or proof that
the registered client exists in production. The current OpenAI Platform draft
shows `https://mcp.usebaci.com/builder/mcp`, OAuth, a verified domain and
“Authorization unavailable”; its displayed MCP settings do not contain a
provided client. The live issuer discovery last checked on 2026-11-12 still
identified the upstream Supabase issuer rather than `https://mcp.usebaci.com`.

The candidate broker in `apps/web/tools/builder-auth/production-config.ts`
requires the public client ID `baci-chatgpt-builder-v1`, and its provider uses
`token_endpoint_auth_method: none`. Dynamic registration and CIMD are disabled.
The local broker test uses a synthetic client and simulated upstream identity
provider; it does not prove the OpenAI callback or live account linking.

After the deployed endpoint, dedicated issuer, callback, and registered client
are verified, the final package's `mcp.json` needs a server entry shaped as
follows. This example is intentionally outside the package and must not be
uploaded as a completed connection until those checks pass:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "baci-builder": {
      "type": "streamable-http",
      "url": "https://mcp.usebaci.com/builder/mcp",
      "extensions": {
        "com.openai": {
          "auth": {
            "type": "oauth",
            "client": {
              "mode": "provided",
              "clientId": "baci-chatgpt-builder-v1",
              "tokenEndpointAuthMethod": "none"
            },
            "resource": "https://mcp.usebaci.com/builder/mcp",
            "baseScopes": ["openid", "offline_access", "storefront.read"],
            "defaultScopes": ["storefront.write", "storefront.publish"]
          }
        }
      }
    }
  }
}
```

The requested scope configuration is a candidate: verify the exact scopes
requested by the saved app and the owner's consent screen. Publishing tools
must create an approval intent only; they must not perform owner confirmation.
No client secret belongs in the package. Verify the exact callback supplied by
this draft's connection flow and configure that callback in the dedicated
broker. Do not infer or reuse another app's callback or credentials.

Before reuploading, inspect the saved draft and follow OpenAI's preservation
rules: an upload can replace the bundle and reset attestations. Once the live
issuer and client are qualified, rebuild and inspect the complete ZIP, upload
the intended draft, confirm the imported MCP settings, connect a synthetic
owner, and run the applicable scans and review cases. Do not submit for review.

References: [OpenAI package OAuth configuration](https://developers.openai.com/plugins/build/plugins#oauth-configuration-reference),
[OpenAI submission authentication](https://developers.openai.com/plugins/deploy/submission#configure-authentication-for-submission).

## Local MCP authoring evidence — 2026-11-12

`tests/experience-authoring/mcp-database-integration.test.ts` exercises the
loopback MCP HTTP tool calls through the ES256 access-token verifier, canonical
synthetic connection lookup, experience gateway, dispatcher and disposable
PostgreSQL/PostgREST owner RLS. It checks full-code capability discovery,
source upload and build queueing, a cross-merchant identifier, a read-only
scope attempting a write, and revocation at both the broker and database
boundaries. The test signs its own synthetic bearer token and injects its
synthetic owner's already-authenticated database client; it does not exercise
OpenAI account linking, a real OAuth authorization exchange, the runner, or a
live service. Separate local tests cover portions of those paths, but their
results do not establish a single end-to-end production journey.

A fresh read of `https://mcp.usebaci.com/.well-known/openid-configuration` on
2026-11-12 still returned the upstream Supabase issuer. The proposed dedicated
issuer and client therefore remain unverified for this submission. The existing
Hostinger host (previously misidentified as Contabo) was reachable on that date, but no `runsc` executable was found on
its PATH or at `~/bin/runsc`; its root filesystem was 93% used. This observation
is not an approval to remove files or disrupt existing services, and it is not
proof of a suitable provisioned production sandbox.

The local `production-runner.test.ts` now also calls
`finalize_experience_build` through the loopback MCP listener using a signed
synthetic token, the real gateway, canonical connection lookup and owner RLS.
Source upload, chunk writes, finalization and build queueing also pass through
the MCP listener. The request reaches the signed runner adapter and the real
offline isolated build/browser qualification, followed by independently verified
private-draft and preview delivery and a session-revocation check. Both tests in
that file passed on 2026-11-12. The runner HTTPS handler is dispatched in-process
and the upstream OAuth user session is injected. This is not proof of deployed service-to-service TLS,
ChatGPT OAuth linking, a single MCP-created store-to-checkout journey, or live
public delivery.

## Published listing URL check — 2026-11-12

The configured homepage, `/privacy`, `/terms` and `/contact` all returned HTTP
200 publicly. The homepage identifies Baci and describes store building, and
the contact page offers a form, email and telephone. The terms page describes
Baci accounts, services and user content. The privacy page's “Merchant AI
connectors” section describes a read-only connector such as Muse, its separate
credential and audit practices, and says those connector tools cannot change
store settings. It does not specifically describe this builder's OAuth session,
custom source uploads, private previews, draft changes or owner-approved
publication. Consequently its suitability for the proposed app's actual data
practices has **not** been established; its read-only language must not be
represented as a complete description of the builder. Verify actual data
flows, retention, deletion, recipients and policy coverage with the responsible
publisher before updating the policy. The general homepage also does not
clearly identify the ChatGPT builder integration; verify whether a public
product page specific to the app is needed. HTTP success alone is not policy
coverage or submission readiness.

The same local synthetic journey now requests `apply_experience` via MCP after
build capture. An attempted owner confirmation without independent verifier
proof fails; the test then records verifier evidence and confirms through the
separate owner path. It still uses an injected owner session and an in-process
runner transport, and it does not publish or perform checkout.

## Local fixed-helper OS check — 2026-11-12

`BACI_LOCAL_EXPERIENCE_QUALIFICATION=1 pnpm --config.verify-deps-before-run=false exec vitest run --config vitest.experience-runner.config.ts tests/experience-browser/helper-linux-os.test.ts --maxWorkers=1`
passed on the disposable Colima Linux VM. The test copied the candidate helper
to a uniquely named temporary file, ran a synthetic compile through the actual
local `runsc` with the helper's fixed OCI policy, checked the compiler output,
verified the owned job directory was removed, and removed its temporary helper.
It invoked that test copy through the VM operator's existing `sudo python3`, not
a restricted service account or the proposed production sudo policy. It does
not qualify the production host, installation pin, helper immutability, actual
service-account privilege boundary, TLS, or hostile-code isolation. The prior
rootless user-namespace failure on Contabo is not by itself proof that this
separately privileged helper cannot run there; a qualified root-owned helper and
narrow sudo policy are still required before production use.

A further disposable-VM test, `tests/experience-browser/helper-linux-privileges.test.ts`,
created a temporary non-root system account, a root-owned uniquely named helper,
and a narrow temporary sudoers rule. It ran the real local gVisor synthetic
compile through that account, rejected a separate root command, a helper-file
write and an invalid job path, and removed the temporary account, rule, helper
and its own completed job. This verifies those specific cases on the disposable
VM; it is not a comprehensive adversarial audit or a qualified Contabo install,
and it does not establish production image provenance or safe live deployment.

## Current portal and host recheck — 2026-11-12

The saved Baci builder draft still displays the domain as verified and
“Authorization unavailable”; its saved MCP settings contain the streamable
HTTP URL but no provided OAuth client configuration. A read-only request to
`https://mcp.usebaci.com/builder/mcp` returned HTTP 307 to
`https://usebaci.com/builder/mcp`, so that request did not demonstrate the
intended standalone MCP listener. The public discovery issuer remains the
upstream Supabase issuer. No account was connected or submission sent.

The existing Contabo qualification evidence in
`builder-contabo-qualification-20261111.md` already documents an earlier
successful temporary-account fixed-helper and protected-preflight test, using a
same-host observed pin. It is stronger than the later local-only test for the
specific host, but is not independent production provenance or a persistent
installation. On this recheck, noninteractive root access through the existing
`bassey` SSH account was unavailable (`sudo -n` required authentication).
Consequently root-only paths could not be authoritatively inspected; path
absence as an unprivileged user is not evidence that those files do not exist.
The open draft PR #4203's last observed remote head was `aad49318235c`, behind
the local candidate; its green CI applies to that remote head only.

## Operator artifact experiment — 2026-11-12

The runner and protected-preflight entrypoints bundled locally for Node 24 and
failed closed at their expected identity/config checks on this macOS host. The
builder and verifier artifact experiment is **not qualified for deployment**:
selecting the global `react-server` export condition made
`react-dom/server`'s `renderToStaticMarkup` undefined. Selecting only the
`server-only` marker's empty module eliminated that warning, but a fully bundled
artifact failed at startup in a bundled native `sharp` dependency. Leaving
`sharp` external allowed the verifier to reach its expected fail-closed startup
message with the local dependencies, while the fully bundled builder failed on
a Next dependency's `__dirname`; externalizing Next instead produced an ESM
resolution error for `next/link`. These are local build experiments, not a
repeatable release artifact or evidence about production startup.

The builder import graph includes `builder-mcp.ts` -> the protected
`config/business-types.ts` -> storefront templates -> Next client modules, and
its capture path also reaches `sharp`. Resolve and test a portable deployment
layout with correct server-only semantics, Node module resolution, native Linux
dependencies and runtime assets; do not work around the protected business-type
source of truth by silently substituting a stale list. The exact candidate must
be reviewed and tested before any VPS installation.

A candidate repeatable builder-operator bundle configuration now lives in
`apps/web/tools/builder-production/operator-bundle.ts`. Its local test builds
with `sharp`, `jsdom` and Next external, aliases Next's link/image ESM entry
points, substitutes only the server-only marker, and checks that the bundle
loads through to its expected fail-closed startup message with local installed
dependencies. This closes the observed macOS import-time failures but is not a
complete release bundle: exact dependency versions, Linux native binaries,
integrity/provenance, Linux service startup and real configuration remain to
be packaged and qualified. The operator build now generates `preview.html`
beside the bundle, and a bundled resource-reader test checks its exact content;
this does not prove that the deployed host serves it correctly.

## Disposable Linux dependency smoke — 2026-11-12

The candidate operator and preview widget were built into a separate temporary
local directory, then `next@16.4.1`, `jsdom@27.4.0` and `sharp@0.35.5` were
installed there under Linux using pnpm with package scripts disabled. On the
existing ARM64 Colima VM, Node v24.21.0 loaded the builder module and reached
its expected fail-closed error because no private builder configuration was
present. A separate Linux smoke test created and read a one-pixel PNG with
`sharp`, parsed a DOM with `jsdom`, and imported `next/link.js`. The operator
bundle SHA-256 was `75a726cec03275831be28a6b808e9e501748b612c9060df8a40a4bbb30a43f9f`;
the widget SHA-256 was `abfef656d2fdc10b1f66791f9f8a2030bab5a20946dd1b5193bd02b0fefae3a2`.

This confirms only import-time and basic dependency behavior on disposable
Linux ARM64. Dependencies were independently resolved in a temporary package,
not installed from the Baci monorepo's production lockfile; the smoke is not a
release artifact, configured startup, x86-64 Contabo test, source-bound review,
OAuth or checkout proof. It made no production changes.

## Disposable Contabo dependency smoke — 2026-11-12

A uniquely named temporary directory on the existing Contabo host held the
same locally built operator and widget (their SHA-256 hashes matched the ARM64
experiment above). Under unprivileged SSH access, pnpm installed only
`next@16.4.1`, `jsdom@27.4.0` and `sharp@0.35.5`, with package scripts disabled
and its store confined to that directory. Node v24.22.2 on Linux x64 loaded
Next's link, parsed a synthetic DOM and performed a one-pixel PNG round trip.
The operator module then loaded through to its expected fail-closed startup
message after the test forced its existing root-identity guard; no production
configuration was read and no service listener was started. The temporary
directory and its package store were removed and the root filesystem returned
to the previously observed 93% usage.

An initial attempt to force the platform guard by impersonating macOS failed
because `sharp` correctly attempted to load a macOS binary; the subsequent test
forced the UID guard instead, retaining the real Linux platform. This smoke
uses a separately resolved temporary dependency set, not the monorepo lockfile,
and does not establish configured startup, installed host privileges, source
review, endpoint routing, OAuth, isolation, or checkout readiness.

## Lockfile-bound dependency smoke — 2026-11-12

The earlier independently resolved smoke used React 19.3.1 and an unpatched
Next package, so it was not representative of Baci's locked dependency graph.
A temporary test package was instead constructed from the existing
`apps/web` importer and its reachable snapshots in `pnpm-lock.yaml`, retaining
the Baci `next@16.4.1` patch and the original overrides. A frozen, script-disabled
pnpm 11.22.0 install succeeded on both the disposable local ARM64 VM and
Contabo Linux x64. Both loaded the operator to its expected guarded startup
failure and exercised synthetic `sharp`, `jsdom` and Next link imports. The
Contabo Next link included patch hash
`0679e0c29945fc606732a859cafe5301630cc84a4335a89f2a84e53dcf9b0891`;
React and React DOM were 19.2.3. The uniquely named Contabo test directory and
its isolated package store were removed after the test.

The subset was generated for this experiment and has not been reviewed as a
reproducible deployment package. The test did not start a configured service,
access private production configuration, expose a listener or verify OAuth,
runner startup, delivery, checkout or image provenance.

The previously manual lockfile subset is now generated by
`tools/builder-production/operator-runtime-lock.ts`. It preserves the source
web importer's five runtime dependency records, their reachable package
snapshots, workspace overrides and the exact Next patch; it rejects a changed
patch or missing snapshot. Its tests compare the generated records with the
source lock, check determinism and exercise those failures. A generated subset
was installed from the existing pnpm store with `--frozen-lockfile --offline`
and scripts disabled on the disposable Linux ARM64 VM; the native dependency
smoke and guarded startup behaved as above. The generator and output still
need independent review, source-bound CI, a deployment assembly procedure and
configured service qualification; this is not an approved release artifact.

`tools/builder-production/operator-assembly.ts` now creates a separate
`unqualified` candidate directory containing the builder bundle, preview
widget, generated frozen runtime lock and Next patch, with per-file SHA-256
hashes in `manifest.json`. It fails on bundle warnings or unexpected patched
runtime snapshots. The generated local candidate at
`/Users/mac/.codex/tmp/baci-builder-candidate-0uYi3t` is review material only;
it is based on an uncommitted worktree and is not a source-bound release,
verified deployment archive or evidence of configured startup. Focused bundle,
lock and assembly tests and affected lint/typecheck passed.

The assembly now contains the builder, verifier, runner, privileged-preflight
entrypoints and fixed Python helper alongside the widget and frozen runtime
lock. The local test checks the hash manifest, parses each JavaScript artifact,
and verifies each reaches its intended fail-closed identity guard without
starting services. The newer local review candidate is
`/Users/mac/.codex/tmp/baci-builder-candidate-LhotmC`; it supersedes the earlier
builder-only review candidate but remains unqualified, generated from an
uncommitted worktree and unsuitable for deployment without review and further
host/service tests.

The complete 10-file unqualified candidate at
`/Users/mac/.codex/tmp/baci-builder-candidate-LhotmC` was copied to a uniquely
named temporary Contabo directory. Its generated runtime lock was installed
with pnpm 11.22.0, `--frozen-lockfile` and package scripts disabled. On Linux
x86-64 / Node 24.22.2, all ten manifest hashes matched, all four JavaScript
entrypoints passed `node --check`, and each reached its expected fail-closed
identity guard. The test set `getuid`/`geteuid` only within each temporary
process so no configured service or public listener was started. The temporary
host directory and isolated package store were removed afterward. This is an
artifact and import/guard smoke, not actual privileged preflight, configured
startup, live service integration, publication, or independent source review.

`tests/experience-authoring/production-stack-rls.test.ts` now starts the actual
co-located production builder stack and both loopback listeners against a
disposable Postgres/PostgREST database. A synthetic signed bearer passes the
real MCP listener, local forwarder, gateway, owner authorization and RLS for
capability discovery, source upload, chunk write, finalization, build queue and
operation status; a revoked database grant is rejected. The test injects the
synthetic owner client and broker callbacks, does not perform an OAuth exchange
or execute the queued job, and does not start the packaged production process.

The same production-stack test now sends build finalization through the actual
production pipeline and signed runner transport to an intentionally failing
in-process synthetic runner. It observes one `prerender-build` dispatch, an
error response and an owner-readable `failed` job. No browser measurement or
benchmark is run in that failure-path test. This supersedes the earlier note
that the test did not dispatch its queued job; it still does not prove the
production stack can complete a build, authenticate live OAuth or reach checkout.

With `BACI_LOCAL_EXPERIENCE_QUALIFICATION=1`, the same production-stack/RLS
integration test sent two `prerender-build` operations through its signed
runner handler to the actual local offline gVisor compiler. The production
pipeline accepted the matching generated renderer output and requested a
prerender; the fixture deliberately failed that request before performance
measurement, and verified the job became failed. The normal non-gVisor failure
case also passes. This remains a partial synthetic failure-path test: the
in-process runner transport, injected owner session, omitted successful
prerender, live OAuth, delivery and checkout are not end-to-end qualification.

The opt-in production-stack test now permits the real local gVisor prerender
following the two independent compilations. After the production pipeline
accepts that prerender output, the fixture intentionally simulates an owner-data
lookup failure at the next boundary, before any performance worker runs, and
checks that the job becomes failed. The ordinary no-gVisor failure case also
passes. This is not a successful finalized build, live OAuth or checkout proof.

The opt-in production-stack synthetic test now completes a private build through
the real co-located MCP/gateway/pipeline, local gVisor compiler and browser
matrix, and a separate verifier's independent browser matrix and restricted
verifier database role. It then reads the finalized job and verifies revocation.
The fixture deliberately makes performance bootstrap data unavailable; no
performance worker runs, the result says `not-measured`, and
`releaseQualified` remains false. It injects a synthetic owner client and
broker callbacks and dispatches runner HTTPS in-process, so this is not live
OAuth, deployed transport, public delivery or checkout evidence.

The opt-in production-stack test additionally calls `preview_experience` through
MCP, obtains a verifier-recorded capture and requests `apply_experience`. It
confirms that the intent remains `confirmation-required` and cannot be applied
without the separate independent owner-verification proof. The synthetic test
passed with performance not measured; no draft was applied, storefront
published, order created or payment initiated. The owner session remains
injected and the runner transport remains in-process, so live OAuth and a
shopper checkout are still unproven.

The opt-in production-stack journey now launches the generated private preview
using the owner runtime and fetches its prerendered HTML through the actual
loopback output listener. It verifies the generated heading and then removes the
synthetic owner session; the same resource returns 404. An initial test-client
404 was traced to Node fetch replacing the required Host header; using Node's
HTTP client with the configured host exercised the listener successfully. The
fixture still injects the owner client and in-process runner HTTPS adapter and
uses a synthetic non-commerce source; this does not prove deployed HTTPS,
ChatGPT OAuth or shopper checkout.

The separate local Orbit shopper fixture now compiles its synthetic source on
each startup using the offline gVisor compiler and seeds those exact bytes into
the disposable database. With normal local auth/RLS, desktop reached the final
checkout review with a synthetic product and merchant delivery rate. At a
390-by-844 viewport, a clean synthetic cart accepted an item and showed its image,
NGN 250 item price, NGN 1,500 delivery and NGN 1,750 total at final review.
No order or payment was submitted. The browser retained contact and delivery
details from the desktop session, so this is not an independent new-account
mobile test. This shopper fixture seeds a synthetic published head directly;
it does not prove one continuous MCP-to-published-store journey or production
OAuth, deployment, public delivery, or release qualification.

A new, currently unwired public-verification orchestration boundary checks that
trusted expected digests match the bound receipt, obtains output through its
injected trusted fetcher, verifies the browser observation, rebinds the full
receipt and head, and delegates proof recording. Its focused synthetic tests
passed for success, output failure, changed binding, mismatched expectation,
and a recorded order request. Dependencies in that test are mocks; this is not
a real public browser observer or an end-to-end publication test. Production
publication remains disabled until the missing observer and service wiring are
implemented and qualified.

A separate unwired planner now derives one concrete path per declared route
from the bound head and the public RLS-backed runtime, resolves a purchasable
product and variant, and checks each route's head, view, canonical URL and
title. Its synthetic tests cover a changed head, foreign canonical URL, wrong
route family and unavailable catalog; the flow passes the derived plan to its
trusted observer dependency. The planner and flow tests passed (5 tests), as did
affected-package lint and typecheck. An empty catalog currently returns
`PUBLIC_JOURNEY_NOT_READY`; no empty-store publication policy is inferred. This
is not evidence that arbitrary custom interactions can be automatically driven
or that a real public observer is installed.

The durable synthetic delivery fixture now compiles its current source and uses
the catalog's canonical `/smartphones/synthetic-device` path. Both durable
integration cases passed: restart delivery and withdrawal. Affected-package
lint and typecheck also passed (lint reported 18 warnings). Performance
benchmarks remain parked and were not run.

On the next main reconciliation, local merge `a7045a0558` included main
`9f3b465267` without conflicts and retained the uncommitted candidate files.
The synthetic seed integration test and affected-package lint and typecheck
passed after that merge (lint reported 18 warnings). Live issuer discovery still identified the
upstream Supabase issuer. The Hostinger VPS reported 99% root filesystem
usage (3.2G free), and the SSH account could not run `sudo -n`. No cleanup,
runner provisioning, deployment, or production setting change was performed.
The remote draft PR head and its checks do not include the local merge or the
uncommitted candidate.

Correction: the earlier server identification was wrong. The 99%-full host at
82.29.190.219 is the Hostinger `ogabassey` server, not Contabo. A direct
read-only check of Contabo (`vmi3734186`, 45.13.232.127) found its root disk
42% used with 169G available, `runsc` release-20261019.0 installed, and two
active GitHub Actions runner services. This does not yet qualify the sandbox,
the operator service, or the production integration on Contabo. No services
were changed and no files were removed.

A fresh review-only operator candidate was assembled after the main merge at
`/Users/mac/.codex/tmp/baci-builder-candidate-lBluJk`. All ten files matched
the candidate manifest and all four bundled service entrypoints passed
`node --check`. It includes uncommitted worktree changes and is explicitly
`unqualified`: matching its own manifest does not establish independent image
provenance, reviewed source, deployment, OAuth, or a live end-to-end result.
The generated candidate was not installed, copied to a service, or deployed.

The local production-stack RLS integration test now obtains its bearer token
through the actual broker's HTTPS authorization, consent, PKCE exchange and
signed token, then uses the linked-session service for MCP access, custom source
upload and revocation. Its upstream identity provider and authenticated user
client are synthetic fixture adapters; PostgreSQL and PostgREST enforce the
fixture's real auth/RLS policies. This does not demonstrate a live ChatGPT or
Supabase OAuth connection, a deployed runner, or publication readiness.

Local merge `9ae36831b2` incorporates main `3e5b015382` (cart lookup cache).
After the merge, the broker-to-MCP RLS test and the cart lookup cache tests
passed. The candidate remains uncommitted and has not been deployed.

With `BACI_LOCAL_EXPERIENCE_QUALIFICATION=1`, the updated broker-to-MCP test
also passed its local offline gVisor build, independent verification, private
preview and revocation path after that merge. Its upstream identity and user
client remain synthetic; this is not proof of live OAuth, production delivery,
checkout or app submission. Affected-package lint and typecheck passed.

The local broker-to-MCP new-user fixture now starts with no merchant, approves
store creation, creates a private draft with a synthetic email-bearing user
session, retries the same idempotency key, accesses full-code capabilities,
and verifies that another synthetic user cannot read the new merchant under
RLS. The upstream identity provider and user client are still fixture adapters;
this does not establish real signup, live ChatGPT linking, or a complete
new-account-to-checkout journey. The synthetic cart-engine checkout-review and
shipping-route integration tests also passed after the main merge.

The new-user test was extended and passed with
`BACI_LOCAL_EXPERIENCE_QUALIFICATION=1`: after consent and private store
creation it uploaded custom source, completed an offline gVisor build and
independent verification, obtained preview evidence, and fetched the rendered
private preview through the local delivery stack. The fixture uses a longer
synthetic user session to avoid its intentionally unimplemented refresh stub;
the upstream identity provider and user client are still synthetic. Checkout
is covered separately and has not been demonstrated in the same new-user flow.
The normal no-runner failure-path tests, affected-package lint and typecheck
also passed after this extension.

A fresh review-only operator candidate was assembled after the latest merge at
`/Users/mac/.codex/tmp/baci-builder-candidate-Gz3t8S`; all ten files matched its
manifest, and the operator assembly test passed. Its preflight bundle differs
in digest from the standalone bundle in the running host trial, so that trial
cannot by itself qualify this exact artifact. The candidate is unqualified,
unreviewed and undeployed.

Local merge `0d73d1bae5` incorporates main `2bf9c3f5d6` (CI PostgreSQL
installer changes). A new assembly at
`/Users/mac/.codex/tmp/baci-builder-candidate-wvaC9q` has an identical
ten-file manifest to `Gz3t8S`; this does not qualify the candidate or replace
current-head CI and review.

On 12 November, the existing website, privacy, terms and contact URLs returned
HTTP 200 and the latter three rendered Baci policy/contact content. The privacy
page did not explicitly mention ChatGPT, OpenAI or source code in the rendered
text; its coverage of the builder's actual data practices remains unverified.
Reachability does not establish legal adequacy or submission readiness.

The unwired public-verification flow now requires a read-only fetch of every
bound canonical HTML route before observation. Its helper uses exact HTTPS
URL and public-DNS checks, no redirects, bounded response bytes, strict UTF-8,
a 20,000-markup-character guard before inert DOM parsing, and exact title and
canonical checks. It rejects refresh directives and base elements. The focused
tests cover invalid destinations, metadata, private DNS and oversized markup.
The page evidence carries only an allowlist of bounded browser-security headers
and excludes response cookies and unrelated headers; a future isolated browser
must actually enforce and verify those headers. The focused tests cover this
filter as well. The markup guard can reject very
large legitimate documents and needs production evaluation. This is not a
browser observer or proof of live commerce, and the production publication
gate remains closed.

Reassembly after adding the unwired document checks produced candidate
`/Users/mac/.codex/tmp/baci-builder-candidate-khfZrY` with a manifest identical
to `wvaC9q`, confirming those checks are not yet in the packaged operator.
The existing Contabo runner evidence therefore continues to apply only to the
identical runner/preflight artifacts, not to an installed public observer.

An unwired coordinator now composes the owner-scoped head resolver, a freshly
constructed publishable-key anonymous Supabase client, public output/page
checks, verification flow and restricted verifier recorder. It rejects secret
and legacy keys for the anonymous client. Coordinator unit tests substitute the
browser observer, network and database dependencies; the separate disposable
Postgres test exercises the recorder's restricted role and stale-head guard.
This does not install the observer or qualify publication. The browser still
needs an isolated, bounded commerce/network path and a real end-to-end proof.
The targeted coordinator, fetch, page and output tests passed (24 tests), the
separate restricted-recorder database test passed, and affected-package lint
and typecheck passed. No production service was enabled by this work.

A disposable Postgres/PostgREST integration test now exercises the coordinator
with the real owner-scoped receipt/head reads, anonymous published manifest and
file projections, and restricted verifier recorder. A different synthetic owner
is denied; changing the head during observation prevents a proof; an unchanged
head permits the restricted proof. The fixture seeds rows only in its isolated
database. Network responses, route planning and the browser observation are
simulated, so this is not evidence of a working live observer or publication.

Local merge `400e28c3f6` incorporates main `1da0b7904a` (mobile-storefront
cart navigation only). The disposable coordinator/RLS test and affected-package
typecheck passed after that merge; the candidate remains local and unsubmitted.

On 12 November, the opt-in Orbit test passed against a disposable local
PostgREST fixture and a network-disabled gVisor browser. It exercised the
generated storefront, synthetic product/cart operations and checkout review,
then verified that Baci's host-controlled checkout confirmation appeared with
an enabled continue button. Order submission remained blocked. The test did
not click through to the checkout page, exercise shipping in this run, or
qualify the production public observer; earlier checkout proofs are separate.

The still-unwired coordinator now acquires framework scripts and styles directly
referenced by checked public pages. Acquisition is restricted to bounded,
same-origin `/_next/static/` JavaScript and CSS, with public-DNS pinning and
content-type validation. Its tests cover foreign and unsafe paths, private DNS,
incorrect content types and failure before proof recording; the coordinator's
disposable RLS test still uses simulated network and browser results. Dynamic
chunks and the production isolated observer remain unresolved.

The local coordinator also fetches each route's published frame document with
the bound slug and build, and checks its content type, exact delivery CSP,
build marker and script/style integrity. A focused test exercises the actual
production delivery document generator; negative tests reject changed builds,
integrity, policy, extra scripts and private DNS. This remains read-only,
uninstalled and is not a browser-render or live-publication proof.

The local observation relay now allows anonymous publication-state reads only
for the bound canonical origin, merchant slug, build digest and resolved route
paths. It validates the returned active build and policy revision. Focused
tests cover altered inputs, stale or malformed state, private DNS, and real
browser interception; the separate RLS coordinator test still substitutes the
browser. Live observer execution and submission remain pending.

The local relay also restricts launch renewal to the exact bound merchant,
build and route, uses its host-held anonymous CSRF session, and validates the
returned build, policy and expiry. Policy, session and real-browser interception
tests passed. This is not yet an installed worker or live renewal proof.

A local adapter now packages checked output, frame and framework bytes with
the restricted relay for the existing isolated-job executor. It rejects
duplicate resources and oversized jobs (currently 5.5 MB of raw resources),
which may reject legitimate stores and requires qualification. The adapter has
only mocked-executor tests; no production observation worker is installed.

An uninstalled browser route inspector now checks rendered parent metadata,
the exact iframe URL and sandbox, matching build markers and completed frame
hydration. Real Chromium tests with synthetic responses cover client-delayed
frame attachment and negative cases. These tests are not a production frame or
commerce journey and cannot produce a publication proof.

The local browser relay now queues concurrent browser requests before its
single-flight worker channel and refuses later requests after a host failure.
A real Chromium/channel regression reproduced the concurrent-request failure
and passes with the queue; this does not install the observer or prove live
checkout.

The local evidence contract now permits product add, cart read and checkout
review to occur on declared storefront routes, including custom overlays, while
still requiring the ordered journey and rejecting unknown paths. The current
observer is not installed and these contract tests use simulated observation;
they do not establish that a real worker verified those actions.

On 12 November a local synthetic Orbit replay passed inside network-disabled
gVisor with the commerce-evidence collector attached to the actual RLS-backed
cart relay. It observed the selected product add, subsequent cart read and
revalidated checkout snapshot, including a valid checkout session. The test
uses the local fixture and test-only URL mapping; it does not install the
production observer, visit final checkout or submit an order or payment.

The local Orbit sandbox now calls the reusable browser interaction routine,
which clicks custom add and checkout controls and requires the authorized
cart responses and the Baci-controlled checkout confirmation. A synthetic
Chromium negative test rejects a visual success without cart requests. The
routine currently recognizes English button labels and may reject valid custom
or localized controls; it remains uninstalled and is not live-release proof.

On 13 November, local merge `1727a6df4d` incorporated main `b3f1d6619f`.
The combined route and commerce browser observer passed with a synthetic
storefront over its framed worker protocol, and in network-disabled gVisor
using a test-only helper adapter and simulated commerce responses. Altered
output and an attempted order were rejected. Unused assets are verified by
their acquired bytes without requiring every image to render. This test does
not exercise the production helper, live backend, live OAuth or final checkout;
the production verifier is not installed and the publication gate stays shut.

Local merge `1d549c7970` incorporates main `007b3eab0d`. The review candidate
now includes and hashes the fixed observation worker, and the proposed helper
policy identifies it as an offline browser job. The candidate's actual worker
bundle passed the local gVisor synthetic observation using a test-only helper
adapter; helper-policy and candidate-manifest tests passed. The installed
runner and its rootfs pins have not been modified, and this is not an installed
production-helper qualification.

The local browser relay now supports bounded anonymous public-catalog reads for
the bound merchant, selected product and declared collection paths. It rejects
foreign selections and private DNS and strips unrecognized response fields.
The catalog network tests use simulated responses; they do not prove a live
catalog request or an installed observer.

A local internal public-verification boundary now signs a bounded approval ID
and authenticated owner token with a dedicated domain-separated MAC, checks a
durable nonce callback and reauthenticates the owner. A loopback test exercises
the client, listener and handler together. The handler is optional and not
installed in the production service; the authoritative coordinator and
qualified worker still need to be connected before publication can be enabled.

The verifier service can now accept that handler only when an observer is
explicitly injected by trusted startup code; ordinary production startup still
does not supply one. A disposable Postgres/PostgREST test exercised the signed
handler through owner-scoped coordinator reads: a different synthetic owner was
rejected, and the owner recorded a proof. Browser and network observations in
that test are simulated, so it is not end-to-end production proof.

The local observer now requires a matching protected helper preflight receipt,
allows one job at a time, and stops accepting jobs if sandbox preparation or
cleanup has an uncertain outcome. A fixed co-located factory supplies the
helper preflight; ordinary production startup still does not enable it. The
helper and rootfs remain uninstalled, and a safe deployment must resolve the
verifier/runner co-location and permissions before this can be qualified.
Framework acquisition now also permits bounded, same-origin Next.js JavaScript
and CSS chunks requested during observation, through the host's public-DNS
checked fetcher; a local Chromium test executes a dynamically inserted script
and rejects a foreign origin. This is not yet an end-to-end production test.
The bundled observer also completed the synthetic browser flow with such a
dynamic script inside local network-disabled gVisor, using a test-only helper
and simulated cart responses.
The browser interaction routine supports English controls and accessible buttons
annotated with `data-baci-commerce="add"` or `"checkout"`, including localized
labels. Controls lacking both supported labels and annotations remain a release
limitation; the annotations do not substitute for real commerce responses.

Local merge `cc43b0ad8e` incorporates main `a8cba58939`. Production verifier
startup now accepts an explicit `publicObserver: "co-located"` operator setting;
it constructs the observer only after the fixed helper preflight matches the
configured runner toolchain pin, before opening the listener. Without that
setting the handler stays off. Configuration, preflight failure and assembled
candidate tests pass locally. The setting has not been installed or enabled;
the publication approval gate remains disabled pending real qualification.

Merchant activation must also verify account-disconnect availability. The
consent page promises a Baci disconnect option, but the current dashboard and
disconnect action are gated by `BUILDER_ACCOUNT_LINKING_ENABLED`, which is
hardcoded false in this candidate; the broker's direct disconnect route is also
disabled. The owner/RLS disconnect implementation exists, but the live feature
must not be offered until its gate, migrations and end-to-end revocation are
deployed and verified together. Local RPC and action tests alone do not prove
that a merchant can disconnect a live ChatGPT connection.
The private-storage, owner-approval and owner-preview switches are also
hardcoded off, and the Next.js builder gateway requires a separately installed
runtime. A successful VPS preflight cannot by itself enable or verify these
Vercel-side paths; the coordinated release must cover their configuration,
bootstrap and exact deployed revision before an end-to-end claim.
In particular, the private-storage switch is global: enabling it changes the
read, write and onboarding paths for existing merchants as well as the new test
merchant. Do not flip it merely to test this integration. A coordinated
data-migration/rollback and compatibility proof, or an independently reviewed
merchant-scoped rollout, is needed before activation.

Read-only production metadata on 13 November confirmed that Baci's database
still has `page_configs.draft_config`; `builder_require_private_storage()`
raises while that column exists. The cutover procedure and base experience
tables exist, but the observer-proof migration and the verifier/preview login
roles are absent. At the time of the check there were 94 page-config rows,
93 with draft data, and no pending/running/processing legacy layout jobs.
These counts are a snapshot, not a maintenance-window drain or permission to
change data. No production row, role, migration, order or payment was changed.
All 94 page-config rows lacked a corresponding private draft at that instant;
there were no existing private drafts, mismatched merchant bindings or
equal-timestamp divergent pairs in this aggregate snapshot. Those facts can
change before a release and must be rechecked under the cutover locks.
The existing cutover chose the private row when timestamps were equal, even if
the four draft fields differed. A new local append-only migration wraps the
operator-only cutover and stops on equal-timestamp divergence or merchant
mismatch while holding the same table locks. Disposable PostgreSQL 17 tests
reproduced the silent-choice case before the guard, then verified refusal,
preservation of matching/newer private drafts, restricted procedure privileges
and the legacy job-drain gate. This guard has not been deployed or reviewed.
On 13 November, a read-only comparison of PostgreSQL's stored procedure
definition, normalized only for its name, produced the same MD5 fingerprint
(`a5677613f26a2c4317fb5fc2e84a9821`) for the live cutover and the original
procedure wrapped by the disposable test fixture. A catalog query found no
recorded dependencies on the live procedure. This establishes the definition
baseline only; it does not prove every production schema dependency or make
the cutover safe to execute.
An additional disposable PostgreSQL 17 test ran the guarded cutover inside a
transaction and rolled it back: the legacy draft column and synthetic value
were restored, and the copied private row disappeared. This covers rollback
before commit only; it is not a recovery procedure for a committed cutover.
The existing cutover substitutes the current clock for a missing legacy
`updated_at`, which could otherwise choose a different legacy draft over an
existing private draft without knowing which is newer. A second local append-only
guard refuses that ambiguous case; its regression failed before the guard and
passed afterwards alongside the other cutover and RLS tests. A read-only
production aggregate on 13 November found zero legacy rows with a null
timestamp at that instant. That count can change, and neither guard has been
reviewed or deployed.
The five earlier candidate migrations `20261111210849`, `20261111231000`,
`20261111232000`, `20261112002500` and `20261112003000` were also absent from
the production migration ledger at that check. Their source and dependencies
must be reviewed and deployed in order before expecting the candidate to run.

On local merge `cc43b0ad8e`, the disposable PostgreSQL 17 draft-operation tests
passed for guarded cutover, owner/staff RLS, creation, replay and revocation.
The new synthetic merchant test also passed through the local broker/MCP stack,
private source upload, offline gVisor build, independent verification and preview.
Its identity provider and user-client adapters are synthetic, and the database
fixture performs the cutover only in its disposable database. It does not prove
production migration, live OAuth, ChatGPT interaction or a checkout in the same
new-account journey.

On 13 November a further source review confirmed the two local journeys use
different disposable schemas and merchant identities: the new-merchant fixture
builds and previews a simple private source artifact, while the commerce fixture
seeds a separate merchant and generated storefront. A shared fixture must create
the merchant and source through the builder, seed that same merchant's synthetic
catalog through appropriate authorized paths, and exercise the resulting preview
through cart, shipping and checkout review. Copying an identifier or combining
the reports alone would not prove the continuous journey. A fresh read-only
request to `https://mcp.usebaci.com/builder/mcp` returned HTTP 307 to
`https://usebaci.com/builder/mcp`; this is not proof of a working MCP connection.

The local new-merchant test now inserts a synthetic product for the newly created
merchant through its signed user Data API client and checks that another user
cannot insert it. The compact fixture mirrors the owner/staff product-insert
policy observed in read-only production schema metadata on 13 November. The
lightweight fixture test passed. A subsequent offline gVisor run reached build
finalization but failed with `UND_ERR_HEADERS_TIMEOUT` after about five minutes
waiting for response headers; it did not complete preview. This does not prove
the cause, a live deployment, or the remaining same-merchant cart and checkout.
Follow-up source tracing found a release-blocking deadline mismatch: the
finalization path performs two independent builds, a prerender, and a serial
matrix of up to 12 browser captures within one HTTP request. The MCP backend
client and corresponding Next route are both bounded at 300 seconds, whereas
each individual local capture permits up to 60 seconds. The browser matrix
alone can therefore exceed the request budget; the observed error does not
identify which individual stage was slow. Current code only queues a job in
`build_experience`; `finalize_experience_build` performs the actual work in the
request. A timeout may leave the durable job running, failed or finalized.
Resolve this with a reviewed durable worker/lease and status/recovery contract
that preserves independent verification, authorization, retries and the
no-publication boundary; merely raising the client timeout does not fix the
route deadline. Tool guidance now directs the assistant to inspect the same job
after an indeterminate response, but that is not an asynchronous implementation
or a release qualification.

On 13 November a fresh review-only candidate was assembled at
`/Users/mac/.codex/tmp/baci-builder-candidate-ReYXog`; its 11 manifest hashes
were checked locally. Its observer worker SHA-256 is
`84b1a853e570aa8d1e7005f767347e537e91842ca9adc00fdc3dc8178312e808` and its
preflight bundle matches the previous Contabo trial's preflight hash. The
candidate is unqualified: its runner and verifier differ from previous trial
artifacts and its observer is not installed in the existing Contabo browser
rootfs. A read-only Contabo check found 170G free, runsc release-20261019.0,
and both GitHub runner services active. No server files or services changed.

The updated AMD64 browser inventory subsequently matched its independent
reconstruction, and a temporary protected preflight returned toolchain digest
`2fba2335351e62e55017ba6ba40e6317968816486cca7dad5d67469717806710`.
Its restricted account, sudo rule, protected files and staged observer were
removed after the trial. This qualifies that temporary installation check only;
the candidate still needs current-head review, release configuration, a
persistent installation and a real synthetic merchant journey.

On 14 November, the combined local merchant test passed from synthetic OAuth
and MCP draft creation through the same merchant's generated full-code build,
independent verification, storefront cart, merchant delivery rate and checkout
payment step. The browser stopped at the order button; an order-insert trigger
and request filtering prohibited orders and payment operations. The test used
an isolated local database, a synthetic public-read head (not a publication),
an in-process identity-provider substitute, and a local development browser
whose loopback network check was disabled for its fixture. It does not qualify
production OAuth, production HTTPS, live delivery, or ChatGPT tool discovery.
The check used the public-browser, public-read, combined-commerce, background
build, local qualification and local PostgreSQL fixture flags. Affected lint
and typecheck passed locally before the main sync; lint reported 18 warnings.
The same full synthetic journey was rerun successfully after the main sync,
followed by affected-package lint and typecheck; lint again reported 18 warnings.

On the same date, current `origin/main` at
`2281adac14d801b7adf6be3c8bfb9e89f295a699` was merged into the isolated
integration worktree as `135cc94c42`; the uncommitted work was preserved.
The existing draft PR #4203 remains at `aad4931823` and does not contain the
complete local candidate. A fresh public read returned HTTP 307 from
`https://mcp.usebaci.com/builder/mcp` to `https://usebaci.com/builder/mcp`
and HTTP 404 from the builder-specific protected-resource metadata path. The
saved Baci Website Builder draft reports its domain verified but authentication
unavailable, tool discovery incomplete, and review information incomplete. It
remains not submitted and not published. The root protected-resource metadata
advertises the existing commerce surface, not evidence of the builder surface.

On 14 November a fresh production discovery check returned a commerce resource
of `https://mcp.usebaci.com/api` with authorization server
`https://mcp.usebaci.com/agent-auth/v1`; root OpenID discovery returned the
existing Supabase issuer. The builder candidate instead asserts
`https://mcp.usebaci.com` as its issuer and reserves the root OpenID/OAuth
discovery, `/auth`, `/token`, `/jwks`, revocation and callback paths. Routing
those root paths wholesale to the new broker would replace existing discovery
and could disrupt existing connector authorization. Domain verification alone
does not resolve this routing or establish builder OAuth.

The candidate must adopt a distinct builder authorization issuer and route its
metadata and broker paths without changing the existing commerce issuer. An
issuer with a path has different metadata placement under OAuth authorization
server discovery (RFC 8414 section 3) and OpenID Connect Discovery 1.0 section
4.1; the issuer, returned metadata, token validation, upstream callback,
registered client callback and exact ingress routes must be tested as one
contract. A separate hostname is another option but requires verified DNS,
TLS, issuer/callback registration and portal compatibility. Do not change
production routing or claim either option is ready before reviewing and
qualifying the selected configuration alongside the existing connector.
The current local provider, private listener and production configuration tests
passed (11 tests); the MCP and auth-loopback tests passed (7 tests). These test
the candidate's current root-issuer design, not production coexistence.

Later on 14 November the local candidate was changed to use the separate
issuer `https://builder-auth.usebaci.com` while retaining the protected MCP
resource `https://mcp.usebaci.com/builder/mcp`. Its broker config, transport
metadata, token verifier and private auth bridge were aligned; a regression
rejects the former root issuer. Broker/listener tests (14), MCP and production
port tests (11), and issuer/tenant-isolation tests passed. The complete local
synthetic OAuth-to-storefront flow also passed through delivery selection and
the final order button without submitting it; affected lint/typecheck passed.
This does not establish production coexistence. At the time of the check the
new hostname's root discovery still returned the existing Supabase issuer,
and the builder resource still redirected to the marketing host. The new host,
dedicated broker, fixed-path MCP ingress, callback and any DNS/TLS changes need
reviewed provisioning and live end-to-end qualification. The unreviewed local
candidate has not been deployed or submitted.

Subsequent release preparation merged `origin/main` at
`dd0ab51e3f589d3afec980fed01050db48a77679` into the isolated worktree at
`f0fea029ec642ececc940721ebb1ec5a120283f0`; uncommitted candidate work remains
present. On that base, the dedicated broker/listener configuration tests passed
(14), and MCP discovery, issuer rejection, private auth bridge, and disposable
PostgreSQL tenant-isolation tests passed (10). Affected lint and typecheck also
passed; lint reported 18 warnings. The earlier full synthetic checkout pass
predates this latest main sync, so it is not claimed as a rerun on this base.
The draft PR still points to `aad4931823`, not this candidate. Repository
policy requires current-head Codex and Muse review before readiness, while
`.github/muse-code-review.md` says the automatic review credential can be
pay-as-you-go and the workflow cannot distinguish its billing type. Do not
push solely to trigger reviews until the no-additional-AI-cost boundary is
established. This check did not change production ingress, deploy services,
create an order or payment, or submit the app.

Additional local checks on `f0fea029ec` passed the production builder
startup/configuration tests (13 tests across two files) and the isolated runner
startup/configuration tests (10 tests across two files). These are local
contract tests, not evidence that the broker, runner, verifier or ingress is
installed and operating in production.

The subsequent full synthetic run on `f0fea029ec` finalized the sandbox build
and reached the public browser, but failed waiting for the embedded page's
“Added to cart” confirmation. The cart command returned HTTP 200; that alone
does not prove its result reached the embedded page. Development hot updates
were also observed during the interaction. The cause remains unconfirmed and
the checkout stage was not reached in this run. The earlier passing run is not
evidence that the newly synced candidate passes this browser flow.

A diagnostic rerun on the same base passed the full synthetic browser and
shipping-quote flow through the final order button without clicking it (one
test passed, 325.87 seconds). Failure-only frame diagnostics were added before
that run. Because the preceding run failed and the cause has not been proven,
the intermittent frame handoff remains an investigation item; the passing
rerun does not establish production reliability or live OAuth/discovery.

Targeted SDK channel and client tests subsequently passed (11 tests across
two files), including the existing indeterminate-mutation and reconciliation
contracts. The worktree's shared dependency was unavailable through its
existing linked modules, so a temporary Vitest alias selected this worktree's
shared source and was removed after the run. This isolates the SDK contracts;
it does not reproduce or explain the browser's intermittent failure.

On 14 November, read-only checks still found `/builder/mcp` redirecting from
`mcp.usebaci.com` to the marketing host (HTTP 307), while the corresponding
protected-resource metadata returned HTTP 404. The Vercel connector's apex
domain/project inventory request returned 403, as did the mapped CLI fallback;
therefore project ownership and a safe path-specific ingress change were not
established by those checks. A subsequent explicitly scoped team lookup found
the verified `*.usebaci.com` wildcard attached to the `baci` project, with no
individual builder-auth or MCP project-domain entries in that apex inventory.
This establishes the wildcard association, not a qualified routing design.
No DNS, Vercel project or production route was changed. The listener currently places internal owner routes and public MCP on
one loopback listener, so its network source alone cannot distinguish trusted
internal traffic from traffic forwarded by a public ingress.
