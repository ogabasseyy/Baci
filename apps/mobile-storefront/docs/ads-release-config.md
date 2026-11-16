# Storefront ads: release configuration

Release builds read ad settings from **GitHub Actions secrets** (see the `*-storefront-release.yml` and `storefront-ota-export.yml` workflows). They are baked in at build time, so changing a secret only takes effect in the **next** store build. AdMob unit ids are not secrets, but they live in the secrets store so every build uses the same values.

Development builds (`eas.json` `development` and `simulator` profiles) switch ads on with Google's published test ids. Real ids are never used in `__DEV__`.

## Keys

| Purpose | Secret |
| --- | --- |
| App-wide ads switch (placements + quiz-start interstitial). Also enables the UMP consent gate, which runs before the ATT prompt | `EXPO_PUBLIC_MOBILE_ADS_ENABLED` = `true` |
| Quiz gameplay banner on/off. Also enables the UMP consent gate on its own: the gate runs when EITHER this or `EXPO_PUBLIC_MOBILE_ADS_ENABLED` is `true` (`areMobileAdsEnabled`), so quiz-only builds still get UMP before ATT | `EXPO_PUBLIC_QUIZ_ADS_ENABLED` (set by the workflow when the banner secret exists) |
| AdMob app ids | `STOREFRONT_ADMOB_ANDROID_APP_ID`, `STOREFRONT_ADMOB_IOS_APP_ID` |
| Quiz gameplay banner | `EXPO_PUBLIC_QUIZ_ADMOB_{ANDROID,IOS}_BANNER_UNIT_ID` |
| Rewarded | `EXPO_PUBLIC_QUIZ_ADMOB_{ANDROID,IOS}_REWARDED_UNIT_ID` |
| Quiz start interstitial | `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_QUIZ_START_INTERSTITIAL_UNIT_ID` |
| Post-order interstitial | `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_POST_ORDER_INTERSTITIAL_UNIT_ID` |
| Banners | `EXPO_PUBLIC_ADMOB_{ANDROID,IOS}_{HOME_STRIP,PRODUCT_GRID_IN_FEED,PRODUCT_GRID_MPU,CART_MPU,ORDER_SUCCESS_BANNER,FOOTER_ANCHOR}_UNIT_ID` |

## AdMob ids (publisher pub-9332275663101466, checked 2026-11-15)

| Unit | Android | iOS |
| --- | --- | --- |
| Quiz Gameplay Banner | `ca-app-pub-9332275663101466/8377498012` | `ca-app-pub-9332275663101466/2113286655` |
| Rewarded | `ca-app-pub-9332275663101466/4562834565` | `ca-app-pub-9332275663101466/5393087541` |
| Quiz Start Interstitial | `ca-app-pub-9332275663101466/1354604335` | `ca-app-pub-9332275663101466/7728440990` |

App ids: Android `ca-app-pub-9332275663101466~8068473535`, iOS `ca-app-pub-9332275663101466~9414437070`.

## Consent order

Google's consent message (UMP) runs before Apple's tracking prompt (`hooks/use-app-tracking-transparency.ts` calls `gatherConsentBeforeTracking`). Keep that order: both stores rejected earlier builds over tracking.
