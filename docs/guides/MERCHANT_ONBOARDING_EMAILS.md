# Merchant setup email journey

This journey is installed disabled. It must not be enabled until Zoho Campaigns
and ZeptoMail inventory has been checked for competing Baci merchant workflows.
Provider preflight on 23 October 2026:
- The available MCP tools cover Zoho Mail, not Campaigns/ZeptoMail administration.
- Local/worker snapshots lacked Campaigns OAuth configuration, but live Vercel
  metadata contains it. Global Campaigns is enabled; its auto-send flag is empty.
- Exactly one merchant configuration has Campaigns settings and a refresh token.
  The live client/secret plus that token returned `invalid_client`, including a
  retry with the application's whitespace normalization. No contacts were enrolled.
- The management OAuth token refresh works, but its granted scope is only
  `Zeptomail.Domains.All`. The documented agent-list read returned HTTP 401
  (`SERR_123`); the send-only token also cannot list agents.
- Workflow/template inventory therefore remains unverified. Restore Campaigns
  OAuth access and authorize read scopes for ZeptoMail agents/templates, or inspect
  the existing consoles after sign-in. Do not interpret these failures as an empty
  provider account. No new provider workflow or marketing list was created.
- The temporary credential export was removed after these checks. No credentials
  or recipient records are part of this implementation or its logs.

## Operation

### In-app setup reminders

An owner sees one contextual reminder across the web dashboard. It selects the
next incomplete required step from the existing web readiness checklist and links
straight to it. Once all required steps are complete, it offers store publication.
Unprovisioned or published stores show no reminder. Existing unpublished merchants
can see this live assistance; this does not enroll them into the email journey.

The normal authenticated client loads readiness and checks the existing in-app,
banner, and follow-up alert preferences. Disabling any of those suppresses the
reminder. Follow-up Alerts now describes both setup and customer-invoice reminders.
The reminder refreshes on dashboard navigation, browser focus, and once per minute
while visible. No push notification, toast, or duplicate notification inbox row is
created. There is one live projection, so completed task alerts do not accumulate.

“Remind me tomorrow” persists a 24-hour snooze across devices in the RLS-protected
`merchant_onboarding_reminder_state` table. The state belongs to both merchant and
owner; staff, other owners, and former owners cannot access it. Read failures hide
the optional banner; failed snooze writes retain the reminder with retry feedback.
In-app assistance does not depend on external email-provider inventory access.
The production notification table was inspected on 23 October 2026 and contained
zero notification rows; no existing in-app setup sequence was found there.

### Email setup journey

Future merchant INSERTs enroll exactly one version-1 journey: welcome after two
minutes, first-product reminder after one day, missing launch requirement after
three days, publication reminder after five days, and setup-help offer after
seven days. Each stage expires 24 hours after its original due time. No existing
merchant is backfilled. Customers and staff-only accounts never enroll.

Only confirmed, non-deleted/non-banned owners whose merchant still belongs to the
original owner are eligible. Home page and domain provisioning must exist.
Published stores stop receiving follow-ups. Preferences and current launch facts
are checked again before dispatch. A database claim prevents concurrent sends;
a 24-hour cap applies across the journey. A stage is sent once at most; the
provider reference is a reconciliation aid, not provider-side idempotency.

The internal VPS worker runs every ten minutes through the existing stable-checkout
launcher. It uses background-only service access; no user-facing route receives
that client. Canonical launch-readiness and payment functions select the next
setup action from a minimal worker projection. No raw identity values, bank
details, or credentials are included in that projection.

Mail uses the platform Baci sender and audited ZeptoMail transport with one
transport attempt. Queue IDs and sequence/stage/merchant links are audit metadata.
Acceptance is distinct from delivery. Interrupted/uncertain dispatches are marked
`unknown` and never retried automatically; reconcile ZeptoMail by
`merchant-onboarding:<job-id>` before deciding on manual action. Do not retry an
unknown send just because a worker timed out. Pre-dispatch failures defer one hour
until the original expiry, and an unavailable worker/schema returns a nonzero exit.

The app-hosted `/onboarding/email-preferences` handler uses the normal Supabase client and a single-purpose,
opaque-token RPC. GET only displays a confirmation so mail scanners do not change
preferences. POST disables reminders. No service-role client is constructed by
this public route. Tokens and email addresses must not be logged.

## Release order

1. Inspect provider automations/templates/lists and record which system owns
   each merchant journey. Reuse or disable the competing path before activation.
2. Run local regression/SQL checks and required code reviews. Apply only the new
   email and in-app reminder migrations; do not replay historical migrations
   against production. The in-app table must exist before deploying its web UI.
3. Deploy the old `send-welcome-email` endpoint as the inert HTTP 410 implementation
   with JWT verification enabled. Verify it cannot send mail. The migration retires
   `on_email_confirmed`; the web workflow no longer sends direct welcomes.
4. Deploy the app-hosted confirmation handler at `/onboarding/email-preferences`.
   Its normal-client token capability only disables reminders. Use the configured
   application origin, since default Supabase domains do not render HTML forms.
5. Deploy the web/worker sources through the approved VPS prebuilt/release flow.
   Confirm the ten-minute worker schedule points at the promoted checkout.
6. Verify a monitored Baci support mailbox for Reply-To, provider authentication,
   actual test-recipient delivery and opt-out. No historical customer backfill.
7. Set the singleton control's `provider_inventory_checked_at`, meaningful
   `provider_inventory_evidence`, and verified `support_reply_to`. Only then set
   `enabled=true`. Missing evidence or Reply-To fails the database constraint.
8. Inspect queue outcomes and `email_send_attempts` acceptance IDs, and confirm
   post-task suppression with controlled recipients before wider operation.

Disable delivery immediately by setting the singleton control's `enabled=false`.
The last dispatch check honors it; an already-started transport cannot be recalled.
Expired stages remain skipped on resumption. Do not erase claims to “restart.”

The implemented messages are operational assistance for the requested store setup.
Promotional first-sale campaigns, discounts, generic nurture and win-back remain
on the marketing-provider side and are not sent through ZeptoMail. Verify existing
Campaigns ownership/subscriptions before extending those journeys.

## Verification

Vitest: `pnpm --filter @baci/web exec vitest run src/lib/onboarding-emails`.
The SQL fixture requires a disposable PostgreSQL 17 instance and isolated roles:
apply `supabase/tests/merchant_onboarding_email_fixture.sql`, the new migration,
then `supabase/tests/merchant_onboarding_email.sql` with `ON_ERROR_STOP=1`.
Never run the fixture against Supabase or any production database.

For combined regression coverage, apply the email fixture, then
`supabase/tests/merchant_onboarding_in_app_reminders_fixture.sql`, both new
migrations, the email assertions, and finally
`supabase/tests/merchant_onboarding_in_app_reminders.sql`. The additional fixture
supplies the local auth identity function and a second owner for RLS isolation.
