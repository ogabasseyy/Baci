# Savings push registration lane handoff

## Findings

The shared storefront path is `apps/mobile-storefront/hooks/use-push-notifications.ts` calling `registerForPushNotifications()` and `savePushTokenToServer()`. Server registration uses the authenticated `register_push_token` RPC with `p_app_type: 'storefront'`, the resolved merchant ID, and the current Supabase session. Logout/account-transition cleanup is separately owned by `stores/auth-store-push.ts` and auth-store actions.

The storefront classification is present. Parent review found a separate source blocker: `services/push-notifications.ts` returns before loading native push modules or creating a token whenever `isStorefrontTelemetryExcluded()` is true, including hosted staging. The sanitized hosted runtime also rejects `extra.eas.projectId`. Its transport and the staging gateway already allow the exact Expo registration endpoints and `register_push_token` RPC. Missing routes or OS permission alone do not explain or fix this source boundary. No device was accessed; the audit's zero-token count was not rechecked in this implementation pass.

## Change

Registration is extracted into `use-savings-push-registration.ts`. Automatic cached-token saves and foreground retries share `savings-push-registration.ts`, a single in-flight boundary keyed by user, merchant, and token. Stale responses after logout, account/merchant changes, and unmount are discarded. Retries check the existing isolation gate, current OS permission, and opt-out; they do not request permission or fabricate tokens. The existing explicit registration entry point remains the native acquisition path.

Parent rejected the initial parallel retry implementation, corrected a null-override logout crash and late-acquisition loading state, removed an unreviewed native token-refresh expansion, and added lifecycle regression coverage. This is not verified native token refresh or phone delivery.

## Device acceptance step

First implement a dedicated isolated native staging push capability/profile with the correct Expo project and build credentials, separate from analytics/ad telemetry. Do not simply remove the existing telemetry guard or borrow production registration. Then use the physical staging build, OS permission, synthetic customer and push opt-in; verify an active storefront token in the isolated database before testing delivery and deep links. Changing those runtime/profile guards, obtaining an actual token, and sending a notification were not done here. Granting OS permission to the current hosted profile alone is insufficient.

## Parent wiring and gates

No server worker, SQL, runtime/profile, or credential changes are included. Parent owns device/provider acceptance and any notification delivery validation. The code hardens registration retries; it does not establish native staging capability, a real Expo token, or successful delivery. Existing notification generation and paid-interest gating remain unchanged.
