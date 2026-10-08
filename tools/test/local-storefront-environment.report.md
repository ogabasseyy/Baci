# Local storefront safe-start handoff

READY FOR PARENT REVIEW — LOCAL NORMAL STARTUP

## Launcher contract

Use `buildLocalStorefrontEnvironment(options, source)` from `tools/test/local-storefront-environment.mjs` and spawn with exactly its returned `environment`, not a merge with inherited environment. Required options: `apiOrigin`, `supabaseOrigin`, `supabaseAnonKey` (public local anon only), `token` (48 lowercase hex), `merchantId`, and `expectedAuthIssuer`.

- API: `http://192.168.100.70:4193`.
- Supabase relay: `http://192.168.100.70:4192`.
- Expected Auth issuer: `http://127.0.0.1:55431/auth/v1`, exported as `EXPO_PUBLIC_LOCAL_AUTH_ISSUER`.
- Merchant: `10000000-0000-4000-8000-000000000001`.
- Flags: `EXPO_PUBLIC_LOCAL_STOREFRONT=1`, `EXPO_PUBLIC_PHONE_QA=0`; normal Expo Router entry.
- Capability: `EXPO_PUBLIC_LOCAL_STOREFRONT_TOKEN`; injected as `x-baci-local-test` only to the two exact configured origins.
- `launchReady: true`, `blockers: []`, `requiresFullReload: true`. Restart Metro with the new environment and fully reload the iPhone JS runtime.

## Safety scope

The fetch guard is installed before monitoring/router imports and rejects foreign JWT issuers, including other loopback/LAN projects, before transport. Issuer matching is not signature verification; real local Supabase Auth remains authoritative. Foreign API keys, cookies, proxy authorization and off-origin fetches are rejected. This is a JS fetch boundary, not an operating-system network firewall.

The normal email OTP adapter only accepts customer@savings.local.test, sends real GoTrue OTP with create_user=false, verifies real OTP, and leaves existing credentials/setSession flow intact. Google/Apple actions return the local-email-only error before OAuth/native SDK calls. No fake auth or session injection.

Full local API+Supabase origins namespace AsyncStorage, MMKV, SecureStore auth/login resume and persisted React Query state. Auth-store memory requires the full reload. Existing customer/cart/wallet/query data is neither read under production keys nor cleared/deleted. Default nonlocal behavior is preserved.

Local config skips dotenv and uses a fresh manifest, local merchant and public anon keys; monitoring/ads/push initialization is guarded. Actual Expo serialization turns null into objects, so disabled Facebook fields deliberately use empty strings. Payments/funding remain subject to the parent's disabled DB settings and narrow relay; no additional payment operations are enabled.

## Validation

- Node launcher/config tests: 55 passed.
- Final focused Jest: 8 suites, 111 tests passed (fetch issuer/capability, runtime, OTP, social OAuth, auth store and app config).
- Earlier broader scoped Jest: 31 suites, 243 tests passed; not a full-repository test run.
- Actual offline Expo public-manifest command passed: exact local origins, merchant/issuer, disabled updates and falsy Facebook/PostHog/TikTok/EAS configuration.
- Root turbo lint: 4/4 tasks passed, zero errors; 20 existing warnings.
- Root turbo typecheck: 6/6 tasks passed.
- Scoped Biome: 37 files checked, zero errors, two existing warnings.

No source-scope startup blocker remains. Physical-device startup/UI is not verified by this task. Parent owns the actual local services, relay and live OTP/Mailpit checks. No cloud/provider call, deploy, push, commit, production credential usage or user-data clearing was performed. Expo may reformat tsconfig during startup; only formatting was corrected while preserving its generated include/exclude changes.

## Changed files in this scope

- `tools/test/local-storefront-environment.mjs`
- `tools/test/local-storefront-environment.test.mjs`
- `apps/mobile-storefront/app.config.ts`
- `apps/mobile-storefront/index.js`
- `apps/mobile-storefront/config/local-storefront-expo-config.js`
- `apps/mobile-storefront/config/local-storefront-expo-config.d.ts`
- `apps/mobile-storefront/config/local-storefront-expo-config.test.mjs`
- `apps/mobile-storefront/lib/local-storefront-storage-prefix.ts`
- `apps/mobile-storefront/lib/local-storefront-storage-prefix.test.ts`
- `apps/mobile-storefront/lib/storefront-async-storage.ts`
- `apps/mobile-storefront/lib/storefront-async-storage.test.ts`
- `apps/mobile-storefront/lib/storage.ts`
- `apps/mobile-storefront/lib/storage-batch.ts`
- `apps/mobile-storefront/lib/query-client.ts`
- `apps/mobile-storefront/lib/imei-pending-storage.ts`
- `apps/mobile-storefront/lib/utility-beneficiaries.ts`
- `apps/mobile-storefront/lib/loyalty-redemption-idempotency.ts`
- `apps/mobile-storefront/hooks/use-permission-booster.ts`
- `apps/mobile-storefront/hooks/useStoreReview.ts`
- `apps/mobile-storefront/components/auth/login-resume-state.ts`
- `apps/mobile-storefront/lib/supabase.ts`
- `apps/mobile-storefront/lib/supabase.test.ts`
- `apps/mobile-storefront/lib/create-local-storefront-fetch.ts`
- `apps/mobile-storefront/lib/create-local-storefront-fetch.test.ts`
- `apps/mobile-storefront/lib/install-local-storefront-runtime.ts`
- `apps/mobile-storefront/lib/install-local-storefront-runtime.test.ts`
- `apps/mobile-storefront/lib/local-storefront-auth-api.ts`
- `apps/mobile-storefront/lib/local-storefront-auth-api.test.ts`
- `apps/mobile-storefront/lib/storefront-auth-api.ts`
- `apps/mobile-storefront/services/error-monitoring.ts`
- `apps/mobile-storefront/services/analytics-core.ts`
- `apps/mobile-storefront/services/ad-tracking-native-modules.ts`
- `apps/mobile-storefront/services/push-notifications.ts`
- `apps/mobile-storefront/services/local-storefront-telemetry.test.ts`
- `apps/mobile-storefront/stores/auth-store-oauth.ts`
- `apps/mobile-storefront/stores/auth-store-oauth.test.ts`
- `apps/mobile-storefront/tsconfig.json`
