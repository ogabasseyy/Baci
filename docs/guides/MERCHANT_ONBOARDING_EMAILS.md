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
- Browser inspection after the owner selected the correct account verified
  ZeptoMail organization `907480120` (Baci Technologies Limited), with one
  `mail_agent_1` created on 28 November 2025. Both `usebaci.com` and
  `ogabassey.com` are associated; Baci's DKIM and bounce records are verified.
  The agent has no saved email templates. Recent logs contain delivered
  `Welcome to Baci - Your store is ready!` messages alongside Ogabassey
  sign-in emails, confirming that the existing welcome path is still live.
  Retire that path during the release before enabling the replacement journey.
- The account dashboard reports 1,826 sent and 1,813 delivered over its last
  seven days; these are account-wide email events, not merchant signup counts.
  It displays one credit with 441 of 10,000 emails remaining and auto top-up
  disabled. Confirm available sending capacity before activation; no credits
  were purchased or billing settings changed during the audit.
- Agent email tracking is disabled. Dashboard zero-open/zero-click counts are
  not evidence of zero engagement. Measure onboarding task completion and store
  publication separately; no tracking configuration was changed during audit.
- Campaigns under the owner-selected Baci login stops at initial account setup. The earlier
  Campaigns organization `907477262` showed no workflows with all active owners
  and all statuses selected. These findings do not establish that every possible
  Zoho login is empty. The inventory covers the accounts selected by the owner
  during this audit. No new provider workflow, Campaigns
  account setup, or marketing list was created by this audit.
- The temporary credential export was removed after these checks. No credentials
  or recipient records are part of this implementation or its logs.
- The owner selected the connected `support@usebaci.com` mailbox for onboarding
  Reply-To. Use that address for the control's `support_reply_to` after completing
  the controlled delivery and reply checks in the release order below.

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
the global delivery flag is separate from a merchant's preference. A global
pause returns claimed work to pending; a merchant opt-out skips the stage.
A 24-hour cap applies across the journey. A stage is sent once at most; the
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
unknown send just because a worker timed out. Pre-dispatch failures and definite
provider rejections defer one hour until the original expiry. The transport's
explicit `deliveryOutcome=unknown`, or an exception after dispatch with no reliable
result, requires reconciliation. An unavailable worker/schema returns a nonzero exit.
Both setup-task and opt-out links use the configured application origin.

The app-hosted `/onboarding/email-preferences` handler uses the normal Supabase client and a single-purpose,
opaque-token RPC. GET only displays a confirmation so mail scanners do not change
preferences. POST disables reminders. No service-role client is constructed by
this public route. Tokens and email addresses must not be logged.

## Release order

1. Inspect provider automations/templates/lists and record which system owns
   each merchant journey. Reuse or disable the competing path before activation.
2. Run local regression/SQL checks and required code reviews. Apply only the new
   email, in-app reminder and delivery-pause migrations; do not replay historical migrations
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
then `20261023131010_merchant_onboarding_delivery_pause.sql`,
then `supabase/tests/merchant_onboarding_email.sql` with `ON_ERROR_STOP=1`.
Never run the fixture against Supabase or any production database.

For combined regression coverage, apply the email fixture, then
`supabase/tests/merchant_onboarding_in_app_reminders_fixture.sql`, the email,
in-app reminder and delivery-pause migrations, the email assertions, and finally
`supabase/tests/merchant_onboarding_in_app_reminders.sql`. The additional fixture
supplies the local auth identity function and a second owner for RLS isolation.
Apply the delivery-pause migration before running the email assertions in either
fixture setup.
