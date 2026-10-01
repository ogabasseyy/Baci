# Mobile Signup Monitoring

Mobile merchant signup is monitored as one privacy-safe lifecycle across the
native app, Supabase Auth, the merchant-provisioning API, and the scheduled
database-policy health check.

Live dashboard: [Mobile Signup Health](https://eu.posthog.com/project/202711/dashboard/877416)

## Signals

| Signal | Source | What it proves |
| --- | --- | --- |
| `admin_signup_lifecycle` | Mobile app | Auth attempts, DNS retry/failure, verification, provisioning start, and client-observed completion |
| `admin_signup_lifecycle` | Provisioning API | Authoritative validation, RPC/database, starter-facts, homepage, and success outcomes |
| `admin_signup_health` | Five-minute health cron | The signup RLS, grants, RPC privileges, and policy invariants still match the deployed contract |
| `mobile_onboarding_contract_telemetry_canary` | Daily health cron | The server-to-PostHog telemetry path is still delivering events |
| `$exception` | Mobile and server error tracking | Unexpected crashes and server exceptions, with existing privacy sanitization and release context |

`signup_attempt_id` is a random UUID used only to correlate steps. It is not an
authorization input. The server validates it and ignores missing or malformed
values. Both event producers omit the property when the ID is missing or
malformed; funnel queries that correlate steps should require the property to
be present. `signup_flow` separates merchant signup from staff account creation
so staff invitees do not look like abandoned merchant signups.

The event contract never includes email, password, OTP, phone, names, business
details, user or merchant IDs, request bodies, URLs, network identifiers, or raw
error messages. Network context is limited to connection state, reachability,
and broad connection type.

## Dashboard Panels

The dashboard currently contains the verified daily telemetry heartbeat. Add
the following panels only after the named events and properties appear in the
production PostHog schema:

1. Merchant signup funnel: `auth/started` → `auth/succeeded` or
   `verification_required` → `verification/succeeded` →
   `provisioning/started` → `provisioning/completed`.
2. Failures by `failure_class`, split by `telemetry_source`.
3. Provisioning API failures by `signup_stage`, `postgres_code`, release, and
   platform.
4. Connectivity failures by native app/build version, network type, and retry
   outcome.
5. Scheduled signup health by `health_outcome` and failed invariant.

Use `signup_attempt_id` for debugging one flow, not as a person identity or a
dashboard breakdown.

## Alert Policy

Configure and test notification delivery after the instrumented web and mobile
releases have produced real events:

- Critical: any `admin_signup_health` with `health_outcome` equal to `degraded`
  or `unavailable`.
- Critical: any provisioning-API lifecycle event with `http_status = 500`.
- Critical: no daily `mobile_onboarding_contract_telemetry_canary` on a
  complete UTC day. Treat this as monitoring unavailable, never as zero signup
  traffic.
- Warning: merchant auth failure rate above 30% for 30 minutes with at least
  five starts. Exclude `account_exists` and staff flows.
- Warning: three or more DNS/transport failures within 15 minutes, or an
  anomaly above the established baseline.
- Warning: provisioning starts without client completion after a 30-minute
  allowance, grouped by the opaque attempt ID.

Low traffic makes percentage-only alerts unreliable. Keep the absolute
database-health and server-500 alerts even after a failure-rate baseline exists.

## Release Verification

1. Deploy the web instrumentation and run the protected
   `/api/cron/merchant-signup-health` check through the normal VPS worker.
2. Confirm `admin_signup_health` is present and contains no customer data.
3. Release the mobile build and complete one controlled merchant signup,
   including email verification when enabled.
4. Confirm the same opaque attempt ID reaches auth, verification, provisioning,
   and completion events without becoming a PostHog person identifier.
5. Create the lifecycle panels and alerts above, then exercise their delivery
   in staging or with a controlled alert test. Record the destination and owner.

Do not claim active paging from cron exit codes or log files alone. Until a
destination is configured and tested, inspect the dashboard and
`/home/bassey/baci-workers/logs/merchant-signup-health.log` during incidents.
