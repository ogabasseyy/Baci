# Address approval callback audit — 28 October 2026

Official contract refreshed from:
https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/third-party-collection/support-apis#webhooks

## Verified current boundaries

- Oxygen documents one callback URL per partner, configured through create/update. No read-registration endpoint is documented. The callback receiver URL belongs to us; there is no fixed Oxygen inbound callback URL.
- API_KEY sends api_key/api_secret; no separate HMAC exists in the documented sender. Our Next receiver validates these before worker login, validates/bounds JSON, durably accepts the event and schedules provider reconciliation.
- Address success payload contains only phone_number, address_validated=true and webhook_type=address_status_update. Treat it as a scoped KYC-read hint. It cannot approve an application by itself. No separate selfie/NIN callback is documented.
- Isolated staging callback inbox inspection found one queued historical transaction from October 20 and no address events. This does not prove which external URL Oxygen currently holds or whether it attempted delivery elsewhere.
- The older documented staging receiver used a temporary old-laptop URL. Its local private receiver directory is absent on this laptop. The transferred runtime has callback key/secret configured; values were not printed or changed.
- Current application order 690a9d2e-33b7-4106-8c68-b9019f814dce has all six KYC statuses DONE per the provider read. The actual checkout now advances to the saved booked plan. No approval OTP was requested or submitted.

## Local corrections

1. Observe durable address-review updates every 15 seconds for at most 20 visible, nonbusy reads per viewing session, plus focus/visibility return reads. Stop on advance/unmount; no overlap or provider mutation. Saved reads do not replace the popup with a spinner. Existing bounded provider KYC fallback remains separate.
2. Do not retire address callback work solely because the KYC HTTP request succeeded. If address_status is still PROCESSING (including a cached succeeded read), defer through existing retry keys/budget. Persist the successful status observation but await confirmed DONE before completing the callback.
3. Prepared a loopback-only callback relay at 127.0.0.1:3457. Only GET /health and POST /api/payments/oxygen/webhook are served. No storefront/admin/general API forwarding, cookies, arbitrary upstream or raw request logs. Existing receiver authentication remains authoritative. Tests cover route isolation, limits, header filtering and upstream failure.

## Validation and remaining operations

- 60 focused TS tests passed across callback parsing/authentication, reconciliation and UI saved-state/address progression; four Python relay tests passed. Workspace lint/typecheck passed. No production CWV measurement was made; no new frontend dependency was added.
- Local relay probes: health 200; storefront route 404; unauthenticated webhook 401.
- Source corrections mirrored to the portable local runtime with private backups. No commit, push, deployment, registration mutation, public tunnel, approval, cancellation, activation or settlement performed.
- Public delivery remains unverified. Before replacing the single staging registration, authorize and verify the intended receiver destination. Retain an intent and matching active registration receipt. Do not retry an uncertain update blindly.
- A persistent scheduled worker/drainer is still needed for unattended deferred callback retries. The existing authenticated reconcile route is present, but no periodic production drain was established in this audit. A one-shot Next after() handler alone does not guarantee future deferred processing.
- Production needs an always-available deployed receiver and scheduler, with separate approval for deployment. A temporary laptop tunnel is suitable only for an attended staging delivery test. Keep all financial-action flags disabled.

## Owner-authorized attended staging registration

After explicit owner authorization, started the callback-only relay and a temporary
Cloudflare HTTPS tunnel. Public checks returned health 200, storefront-path 404,
and unauthenticated webhook 401 before the registration mutation. Updated the
single staging registration exactly once using existing callback credentials;
Oxygen returned HTTP 200 with a matching active URL/partner receipt and API_KEY
mode. The existing receipt validator confirmed registration. Raw response is
stored encrypted privately; intent and sanitized result are owner-only. No
credentials were changed or printed.

Public staging callback URL:
https://para-neutral-employed-told.trycloudflare.com/api/payments/oxygen/webhook

An authenticated unsupported synthetic event returned 400, confirming routing
and authentication without accepting an event or changing a workflow. This is
an operator probe, not evidence of a real Oxygen delivery. No address event was
present in the inbox at the registration check. Ask Oxygen to resend the actual
address-success notification to verify the full path. The URL works only while
the local runtime, relay, tunnel and laptop remain running; restarting a quick
tunnel may change its hostname and requires another authorized registration.
The periodic durable drainer and production deployment remain separate work.

## Provider delivery failure and local recovery

Owner supplied Oxygen's delivery log for 2026-10-28T13:26:13Z. Oxygen sent an
address_status_update with address_validated=true and an additional
loan_request_reference field. The receiver returned Cloudflare HTTP 530 / error
1033 before the request reached application authentication. The tunnel log
records QUIC network-unreachable errors, then reconnection at 13:30:17Z. The
runtime SSH connection had also timed out and its launcher stopped dependent
services. These are distinct from address validation failure.

Restarted the local runtime detached from the tool session, with output and PID
stored privately, and scoped idle-sleep prevention to that runtime. The existing
Cloudflare URL recovered without replacing registration. Rechecks returned
health 200, unauthenticated webhook 401 and authenticated unsupported event 400;
no synthetic callback was accepted. A real provider resend is still required.
The single owner-requested address retry had already succeeded HTTP 200 and was
not repeated during recovery. Temporary laptop/network uptime remains a known
limitation; this does not replace a permanent hosted production receiver.

## Exact application reference fix

The actual Oxygen address payload includes loan_request_reference. It is now
validated and retained as applicationReference. Callback candidate resolution
requires the configured worker/partner/merchant/staging binding, matching phone
and, when supplied, the exact application reference. An unknown supplied
reference never falls back to phone. Ambiguous phone-only legacy events remain
retained as observed with resolution_error=ambiguous_address, without fan-out.
The webhook's after-handler drains only the matching event kind/reference so an
old transaction job cannot consume this address notification's work budget.

An append-only migration, 20261028135616_oxygen_address_callback_reference.sql,
was tested transactionally and applied only to isolated staging. The regression
reproduced seven synthetic applications under one phone and verified exact
selection, unknown-reference refusal, legacy ambiguity quarantine, unique
legacy compatibility and unprivileged rejection. The existing callback payment
SQL regression also passed and rolled back. Fifty-two focused TypeScript tests,
workspace lint and workspace typechecks passed. Existing source/runtime copies
were preserved before mirroring the callback changes. No production deployment,
commit or push occurred.

The owner-supplied Oxygen delivery log references application
9617625b-139c-4bd5-af42-9ab0a3cdd81c, which belongs to the older Wema test order
7764861c-2365-456a-a5fd-42dff4839ebf. The current checkout's application reference
is 060ce5db-a5f0-4c9f-88ed-e2d87709a385. The planned operator replay was stopped
before transmission when the exact-reference guard detected this mismatch.
No callback was fabricated for the current application. Worker-scoped pending
inspection quarantined the old ambiguous notifications; the comparison audit
verified all provider states, workflow rows and commands unchanged, with zero
provider calls. The historical transaction callback was not processed. Ask
Oxygen for a new notification naming the current application's exact reference
if a live current-checkout callback transition still needs to be observed.
