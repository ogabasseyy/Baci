## 2025-02-28 - Dynamic fallback token resolution in SafeImage

**Learning:** Hardcoded default fallback icon colors or placeholder backgrounds (e.g., `#F3F4F6`, `#9CA3AF`) prevent correct theming. A fallback prop like `fallbackIconColor` can be provided a default value via the `useColorScheme` / `Colors` hooks inside the component rather than in the function parameter defaults. Inline dynamic styles are required to override static StyleSheet defaults properly without breaking customization.
**Action:** Always import `useColorScheme` and `Colors` to map default prop colors to theme tokens inside the component body, and use dynamic inline styles to merge `colors.muted` with existing container styles.
**Source:** SafeImage.tsx / Colors.ts

## 2026-06-16 — Using correct theme tokens for text on primary backgrounds

**Learning:** Hardcoded white text (`#FFFFFF`) on primary-colored buttons should use the `colors.textOnPrimary` token, which is explicitly defined in `theme.ts` alongside `colors.primary`.
**Action:** Always check the theme file (`theme.ts`) for specific contrast tokens like `textOnPrimary` before falling back to general text tokens or hardcoding values.
**Source:** `apps/mobile-admin/constants/theme.ts`

## 2025-02-25 — [Removed hardcoded '#eee' background from Blog Manager thumbnail]

**Learning:** Hardcoded `#eee` for image thumbnail placeholders fails to adapt to dark mode (appearing overly bright) and violates the rule against color literals.
**Action:** Remove from `StyleSheet.create` and apply `colors.border` (or `colors.background`) via dynamic inline styles `style={[styles.thumbnail, { backgroundColor: colors.border }]}`.
**Source:** apps/mobile-admin/constants/theme.ts / WCAG SC 1.4.3

## 2026-06-28 — Theme tokens instead of hardcoded primary-surface colors

**Learning:** Primary-surface text and switch thumbs should use design-system tokens (`textOnPrimary`, `textMuted`, `BRAND.onPrimary`) so light/dark themes can maintain contrast without raw `#fff` literals.
**Action:** Replace hardcoded native color literals in mobile admin/storefront surfaces with theme tokens and add tests that assert the token flows to the component prop.
**Source:** React Native Switch docs plus Baci mobile theme token files, verified 2026-06-28.

## 2026-06-28 — Dynamic shadow tokens in admin order controls

**Learning:** React Native exposes `shadowColor` as a style prop, but hardcoded `#000` shadows do not adapt to the Baci theme system. `useNewOrderController` already exposes theme shadows from `useTheme()`.
**Action:** Use `controller.shadows` for selected-state shadows in NewOrderFooterBar instead of raw color literals, and keep the selected background on existing color tokens.
**Source:** React Native shadow props docs and `apps/mobile-admin/constants/theme.ts`, verified 2026-06-28.

## 2025-02-28 — Theming FAB icons with textOnPrimary

**Learning:** Hardcoded white (#FFF) icons inside FABs with primary backgrounds fail to use the design system properly. `textOnPrimary` is the correct semantic token for content placed on a primary background in the mobile admin app.
**Action:** Always replace hardcoded #FFF or #FFFFFF with `colors.textOnPrimary` when the element is sitting on a `colors.primary` background.
**Source:** apps/mobile-admin/constants/theme.ts / WCAG SC 1.4.3

## 2026-07-01 — Full shadow token spreads for selected native controls

**Learning:** React Native shadow styling uses multiple platform-specific fields (`shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`, and Android `elevation`), so copying only one field from a theme token leaves the rest hardcoded or stale.
**Action:** Spread the semantic `shadows.sm`/`shadows.md` token object for selected-state controls instead of mixing a token color with raw shadow dimensions.
**Source:** React Native shadow props docs and `apps/mobile-admin/constants/theme.ts`, verified 2026-07-01.

## 2026-07-01 — DateRangePicker overlay and mode shadows use theme tokens

**Learning:** Modal overlays and selected segmented controls should not carry local hardcoded color/shadow literals when the mobile admin theme already exposes `colors.backdrop` and semantic shadow tokens.
**Action:** Move DateRangePicker overlay color to `colors.backdrop` and spread `shadows.sm` for selected mode buttons.
**Source:** React Native Pressable/Modal docs and `apps/mobile-admin/constants/theme.ts`, verified 2026-07-01.
## 2024-11-07 — Replaced hardcoded #FFFFFF with textOnPrimary token in mobile-admin
**Learning:** Hardcoded `#FFFFFF` for text/icons on primary backgrounds in React Native ignores the theme system's `textOnPrimary` token which guarantees correct contrast in both modes.
**Action:** Read `DARK_COLORS` and `LIGHT_COLORS` in `constants/theme.ts` to find the correct token (e.g. `textOnPrimary`) and apply it dynamically.
**Source:** apps/mobile-admin/constants/theme.ts
## 2024-10-31 — Saved Tab Hardcoded Colors Fix
**Learning:** Hardcoded `#FFF` for primary button text and `#F3F4F6` for placeholder image backgrounds were used in the Stylesheet instead of utilizing the `BRAND.onPrimary` and `colors.muted` tokens respectively.
**Action:** Pass dynamic `BRAND.onPrimary` and `colors.muted` tokens inline and remove static color declarations.
**Source:** `apps/mobile-storefront/constants/Colors.ts`
