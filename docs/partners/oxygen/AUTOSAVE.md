# Oxygen application autosave

The identity, bank and employment form saves partial inputs after a short debounce,
on blur, and best-effort when the page is hidden. Closing or reloading the checkout
restores the same authenticated customer's workflow draft. Secure WhatsApp and
webchat handoffs use that same workflow; a phone number alone is not authentication.

Drafts use AES-256-GCM with a dedicated server-only
`OXYGEN_DRAFT_ENCRYPTION_KEY` (32 random bytes encoded as 64 hex characters).
Provision it through the deployment secret store. Never expose it to the browser,
commit it, log it or reuse a provider credential. Preserve the key across restarts;
changing it without a migration makes existing drafts unreadable. User, workflow
and revision are authenticated encryption context. Missing configuration fails closed.

The normal authenticated database client and RLS enforce customer ownership.
Drafts are editable only in staging at `application_required`. Optimistic revision
checks prevent another tab or channel silently overwriting a draft. On conflict,
the customer must reload saved progress. Failed saves show a retry action.
Browser storage, analytics and chat replies receive no BVN, NIN or bank
values. Order/workflow identifiers may appear in continuation paths and telemetry.

Consent, OTPs, documents, account-name verification and provider completion flags
are excluded. Returning to the bank step requires account verification again.
Autosave never submits KYC, approves, activates, settles or creates a provider command.
A page exit with no network is best effort; only the Saved indicator confirms a save.

## Deployment requirements

Apply `20261022102237_oxygen_encrypted_form_drafts.sql`, provision the encryption
key and verify the expiry scheduler before enabling autosave on another host.
Drafts expire seven days after the latest save. The API does not return expired
values. Storage cleanup is hourly, so expired ciphertext can remain until the next
successful purge. API expiry alone does not delete ciphertext.

The migration registers `oxygen-form-draft-expiry` when `pg_cron` is available.
**A host without pg_cron needs an equivalent scheduled database cleanup before
rollout; do not treat a successful migration as proof that retention is configured.**
An operator must verify the active job and monitor execution failures:

```sql
SELECT jobname, schedule, active
FROM cron.job WHERE jobname = 'oxygen-form-draft-expiry';
-- Expected: one active hourly job.
SELECT jobid, status, start_time, end_time
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'oxygen-form-draft-expiry')
ORDER BY start_time DESC LIMIT 5;
```

The equivalent scheduled command is:

```sql
DELETE FROM public.oxygen_form_drafts WHERE expires_at <= now();
```

The isolated staging database has the migration and an active hourly job verified
on 22 October 2026. No production migration or deployment is implied.

## Verification

`supabase/tests/oxygen_form_drafts_rls.sql` checks customer isolation, merchant and
anonymous denial, immutable ownership, revision guards and stage locking in a
rolled-back transaction. Unit tests cover encryption tampering/context binding,
authentication, CSRF, input bounds, expiry, idempotency, concurrent saves, reload
hydration, blur/page-hide flushes and stale workflow responses.

See [CHAT-PIPELINE.md](CHAT-PIPELINE.md) for adapter wiring and live-channel gaps.
