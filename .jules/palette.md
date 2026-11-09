## 2025-02-12 — Missing `accessibilityRole="button"` and `accessibilityState` on Apply Range `Pressable`

**Learning:** The `Pressable` for applying a date range in the custom calendar panel (`DateRangePickerCalendarPanel.tsx`) lacked `accessibilityRole="button"`. It also lacked `accessibilityState={{ disabled: ... }}` to announce its disabled state accurately. While `disabled` handles interactivity, `accessibilityState` ensures proper screen reader feedback.
**Action:** When adding or verifying interactive `Pressable` components, especially those that act as buttons with conditional `disabled` states, ensure `accessibilityRole="button"` and the corresponding `accessibilityState={{ disabled: ... }}` are explicitly set so assistive technologies announce their nature and current interactability correctly.
**Source:** WCAG 4.1.2 Name, Role, Value / React Native Accessibility API

## 2026-05-12 - Missing ARIA Labels on Interactive Icon Buttons

**Learning:** Icon-only buttons (like Plus/Minus for quantity, heart for favorites, X for close) in interactive product components often miss `aria-label` attributes, making them inaccessible to screen readers.
**Action:** Always ensure `lucide-react` icons used as primary interaction points are wrapped in `<button>` tags with explicit, descriptive `aria-label` attributes.

## 2026-05-16 - Missing hitSlop on Compact Action Buttons

**Learning:** Interactive components like icon menus in list cards often fall below the 44x44px mobile touch target requirement, causing tap inaccuracy.
**Action:** Always use `hitSlop` on `TouchableOpacity` elements when their visual constraints prevent them from meeting the minimum 44x44 target dimensions.

## 2026-05-13 - Explicit type="button" for icon buttons

**Learning:** Interactive icon-only buttons without explicit `type="button"` can accidentally trigger form submissions.
**Action:** Always ensure `<button>` tags that don't submit forms have `type="button"` explicitly defined.

## 2024-05-30 - Interactive Elements Pressable Feedback and A11y

**Learning:** Custom interactive elements (like lists or buttons) built with React Native's `Pressable` often lack visual feedback when pressed and do not announce their role to screen readers by default.
**Action:** Always provide visual feedback using the `({ pressed }) => [...]` style pattern (e.g., `opacity: 0.7`) and explicitly assign an `accessibilityRole="button"` (or appropriate role) to enhance both visual UX and accessibility.

## 2026-05-18 - Enhanced Pressable Accessibility and Touch Feedback

**Learning:** In React Native, custom interactive elements using `Pressable` must explicitly define accessibility properties (`accessibilityRole="button"`, `accessibilityLabel`, `accessibilityState`) to be compliant with screen readers. Additionally, providing visual feedback via the `({ pressed }) => [...]` style pattern is crucial for a responsive user experience.
**Action:** Always ensure that every `Pressable` functioning as a button includes appropriate `accessibilityRole`, descriptive labels, state indicators (like disabled), and visual opacity/color shifts when pressed.

## 2024-05-18 - Mobile Admin Pressable Accessibility & Feedback

**Learning:** React Native `Pressable` components in the Baci monorepo often lack visual feedback and screen reader labels when initially created, particularly in dynamic mapped elements like lists and toggles. When refactoring complex `style` properties on `Pressable`, carefully wrapping existing style objects in arrays alongside the `({ pressed }) => [...]` function is necessary.
**Action:** When creating or modifying `Pressable` components, always use the `({ pressed }) => [pressed && { opacity: 0.7 }, ...]` pattern for visual feedback, and assign explicit `accessibilityLabel` attributes (especially mapped elements or icon buttons). Validate syntax correctness when refactoring inline styles.

## 2026-05-20 - Icon-only Buttons Accessibility

**Learning:** Icon-only buttons (like password show/hide toggles) are inaccessible to screen readers without an explicit label.
**Action:** Always add `accessibilityLabel` (and `accessibilityRole="button"`) to `Pressable` components that only contain icons.

## 2026-05-21 - Add aria-expanded to toggle buttons

**Learning:** Toggle buttons (like 'Show more/less') modifying the visual state of content require `aria-expanded` to accurately inform screen readers of their current state.
**Action:** Always bind `aria-expanded={state}` to any button functioning as an accordion or toggle switch.

## 2026-05-23 - Add aria-pressed to toggle buttons

**Learning:** Toggle buttons (like favorite hearts, color swatches) that modify a boolean state without expanding/collapsing content require `aria-pressed` to accurately inform screen readers of their toggled state.
**Action:** Always bind `aria-pressed={state}` to any button functioning as a two-state toggle switch that does not expand content.

## 2026-05-23 - Add aria-controls to aria-expanded toggles

**Learning:** Elements using `aria-expanded` should ideally be paired with `aria-controls` pointing to the ID of the expanded/collapsed container for complete screen reader support.
**Action:** Always add `aria-controls="id-of-container"` to toggle buttons and ensure the corresponding dropdown containers have matching `id` attributes.

## 2026-05-23 - Suboptimal ARIA label on color swatches

**Learning:** Using `aria-label={"Select color " + colorName}` alongside `aria-pressed` is redundant because `aria-pressed` already conveys the stateful nature of the button.
**Action:** Use cleaner labels like `aria-label={colorName}` when using `aria-pressed`.

## 2026-05-23 - Conditionally apply aria-controls for unmounted elements

**Learning:** If the target of an `aria-controls` attribute is conditionally unmounted (e.g., `return null` when closed instead of hidden via CSS), having a static `aria-controls="id"` on the toggle button will point to a non-existent DOM element, causing an accessibility violation.
**Action:** When the controlled element is conditionally unmounted, conditionally apply the attribute: `aria-controls={isOpen ? "id-of-container" : undefined}`.

## 2026-05-22 - Storefront disclosure toggles need explicit state

**Learning:** In the web storefront, custom toggle buttons (like those for filters or expanding order summaries) often miss the `aria-expanded` attribute, causing assistive technologies to remain unaware of the collapsible content's state.
**Action:** Always ensure that custom disclosure widgets or toggle buttons explicitly implement `aria-expanded={booleanState}` to accurately reflect their expanded or collapsed status to screen readers.

## 2026-05-24 - Accessibility for Custom Toggle Switches

**Learning:** Custom UI switches (like the "Wallet Credit" toggle) built with standard `<button>` tags require specific ARIA attributes to function correctly for screen readers. Simply changing styling based on state is insufficient.
**Action:** Always assign `role="switch"` and `aria-checked={booleanState}` to binary toggle switches. Additionally, ensure the switch has an explicit `aria-label` or `aria-labelledby` so its purpose is clear to assistive technologies.

## 2025-05-24 - Interactive Accessibility for Toggle Buttons

**Learning:** When using generic components like `Pressable` as toggle buttons (e.g. for compare, favoriting) they require explicitly defined `accessibilityRole="button"`, `accessibilityLabel` that explains the action based on current state, `accessibilityState={{ checked: booleanState }}` to announce its toggled state, and `accessibilityHint` for context. Missing these leaves screen readers with just a silent clickable area.
**Action:** Always provide the full suite of ARIA/accessibility props (role, label, state, hint) alongside interactive visual feedback (opacity) to any `Pressable` modifying selection state.

## 2025-05-25 - Interactive Press Feedback and Keyboard Refinements

**Learning:** In Expo/React Native apps within the Baci monorepo, many `Pressable` components acting as buttons or interactive cards are missing visual feedback when pressed, which makes the app feel unresponsive. Additionally, form inputs like Amount and Notes may lack `returnKeyType` configurations that improve keyboard UX.
**Action:** When creating or modifying interactive `Pressable` elements, consistently apply the `({ pressed }) => [...]` function pattern to the style prop to provide dynamic visual feedback such as opacity changes. Add `returnKeyType="done"` to form `TextInput`s where appropriate.

## 2026-05-28 - Carousel Indicator Accessibility

**Learning:** Carousel indicator dots represented by unlabelled elements (often generic buttons or divs) lack context for visually impaired users. Without ARIA attributes, they are either invisible or read as generic controls without meaning or state.
**Action:** Always add explicit semantic roles (e.g., `role="tab"` in a `role="tablist"`), state indicators (`aria-selected`), and descriptive labels (`aria-label` explaining which slide the dot targets) to interactive carousel pagination indicators.

## 2024-05-29 - Forgot Password Screen Accessibility

**Learning:** Mobile React Native forms lacking `returnKeyType` or `accessibilityRole="button"` and `accessibilityState` attributes create high friction for keyboard and screen reader users.
**Action:** Always ensure `returnKeyType="done"` with `onSubmitEditing`, use `accessibilityRole="button"`, and set `accessibilityState={{ disabled: true, busy: true }}` on disabled/loading buttons to improve a11y on interactive UI.

## 2024-05-30 - Form Keyboard UX Optimization

**Learning:** In React Native mobile apps, large forms with multiple text inputs create friction if the user must manually tap the screen to move to the next field.
**Action:** Enhance form usability by combining `returnKeyType="next"` with `onSubmitEditing={() => nextInputRef.current?.focus()}` on sequential inputs, and `returnKeyType="done"` with `onSubmitEditing={submitForm}` on the final input.

## 2024-05-30 - Submit Button Loading State Visibility

**Learning:** The `SubmitButton` component visually indicated loading states using React 19's `useFormStatus`, but assistive technologies need the control to remain focusable to announce the busy transition.
**Action:** Pair `aria-busy={pending}` with `aria-disabled={pending}` for submit buttons in loading states, and block clicks manually instead of applying native `disabled` during pending submissions.

## 2026-06-01 - Mobile Action Button States

**Learning:** Submit buttons in React Native that become disabled during loading states must implement `accessibilityState={{ disabled: true, busy: true }}`. Otherwise, screen readers will only announce them as "button" (or "disabled button") without conveying that a background process is active.
**Action:** When creating or updating actionable buttons that show loading indicators or disable during submission, ensure `accessibilityState` explicitly includes `busy: isSubmitting` and matches the `disabled` state.

## 2026-06-02 - Add accessibilityState to mobile toggle buttons

**Learning:** Toggle buttons (like favorite hearts or saved items) in React Native require `accessibilityState={{ checked: booleanState }}` to accurately announce their toggled state to screen readers. Relying only on dynamic `accessibilityLabel` changes is less standard than providing the explicit state.
**Action:** Always add `accessibilityState={{ checked: booleanState }}` to any `Pressable` functioning as a two-state toggle switch.

## 2026-06-03 - Submit button accessibilityState and Pressable feedback

**Learning:** Actionable buttons in React Native (`Pressable`) that are bound to an `isSubmitting` or `isPending` state often disable correctly but fail to announce to screen readers that a background process is active. Additionally, many of these buttons miss visual feedback upon press.
**Action:** Always ensure that disabled primary action buttons implement `accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}` and utilize the `({ pressed }) => [...]` style array to provide visual feedback (like `opacity: 0.7`) to the user.

## 2026-06-04 - Improved Keyboard UX in Forms

**Learning:** In React Native apps, relying on default keyboard behavior for text inputs creates friction. `returnKeyType` improves the visible keyboard label, but smooth field navigation also needs `onSubmitEditing`, `TextInput` refs, and `submitBehavior`, which controls whether Return submits or inserts a newline.
**Action:** For sequences of `TextInput` components, combine `returnKeyType="next"` with `submitBehavior="submit"` and `onSubmitEditing={() => nextInputRef.current?.focus()}` on intermediate fields. Use `returnKeyType="done"` with `submitBehavior="blurAndSubmit"` and a dismiss handler on the final field.

## 2026-06-07 - Add `accessibilityState` to auth loading buttons

**Learning:** React Native's `ActivityIndicator` visually indicates loading, but screen readers require `accessibilityState={{ disabled: true, busy: true }}` explicitly set on the parent interactive element (e.g., `Pressable`) to accurately announce the busy state and prevent double-activation during async operations.
**Action:** When adding an `ActivityIndicator` to a button for loading states, ensure the parent button correctly implements `accessibilityState={{ disabled: isLoading, busy: isLoading }}`.

## 2026-06-10 - Add `aria-label` to dynamically toggled secret input buttons

**Learning:** Icon-only buttons used to toggle the visibility of sensitive information (e.g., "Show/Hide secret" using Eye/EyeOff icons) in settings pages often miss `aria-label` attributes, making their state and purpose opaque to screen reader users.
**Action:** Always ensure icon-only buttons that toggle visibility state have dynamic `aria-label` attributes reflecting the current action (e.g., `aria-label={showSecret ? 'Hide secret' : 'Show secret'}`).

## 2026-06-15 - Screen Reader Announcement for Mobile Loading States

**Learning:** Conditionally rendering a `View` with `accessibilityLiveRegion="polite"` can miss transient loading announcements because screen readers need a mounted live region before content changes; `accessibilityState={{ busy: true }}` can also suppress announcements until busy flips false.
**Action:** For transient React Native loading announcements, trigger the imperative `AccessibilityInfo.announceForAccessibility('Fetching delivery options…')` call from a `useEffect` when the loading state becomes true.
**Source:** React Native AccessibilityInfo API / WCAG 4.1.3 Status Messages

## 2026-06-16 - Added accessibility props to React Native view toggles

**Learning:** Icon-only toggle buttons in React Native (such as Grid vs List view switchers using Pressable) must explicitly include `accessibilityRole="button"`, a descriptive `accessibilityLabel`, and `accessibilityState={{ selected: <boolean> }}` to be fully accessible to screen readers, as Biome's a11y linting does not catch this automatically for RN.
**Action:** When adding or updating icon-only interactive elements in React Native, explicitly add `accessibilityRole`, `accessibilityLabel`, and relevant `accessibilityState`.
**Source:** Memory and React Native Accessibility API docs

## 2024-06-17 — State-aware semantics in React Native

**Learning:** Icon-only toggle buttons and popover menus in React Native components (like `FilterBar`) often lack `accessibilityState` semantics and `accessibilityRole`. While visual cues like color changes are present, screen readers don't announce whether a toggle is expanded or which popover item is currently selected.
**Action:** Always verify that interactive elements reflecting state changes use `accessibilityState={{ expanded: boolean }}` for toggles and `accessibilityState={{ selected: boolean }}` for lists/tabs, along with `accessibilityRole="button"` and a descriptive `accessibilityLabel`.
**Source:** WCAG SC 4.1.2 Name, Role, Value

## 2025-02-19 — Added accessibilityState to Cart Quantity Control

**Learning:** By default, setting the `disabled` prop on a `Pressable` in React Native prevents interaction but does not automatically inform assistive technologies (like VoiceOver or TalkBack) of the disabled state.
**Action:** When conditionally disabling an interactive element, always pair the functional `disabled` prop with the semantic `accessibilityState={{ disabled: boolean }}` prop.
**Source:** WCAG 4.1.2 Name, Role, Value / React Native Accessibility API docs

## 2026-06-28 — Mobile admin small UX/a11y rollup

**Learning:** React Native exposes `accessibilityState.disabled` and `accessibilityState.busy` for controls and `TextInput.returnKeyType` for keyboard-return affordances. Use these props rather than web-only ARIA props inside native components.
**Action:** For disabled text inputs, async submit buttons, and final IMEI/serial fields, keep functional state and semantic state in sync with `accessibilityState` and `returnKeyType="done"`.
**Source:** React Native Accessibility and TextInput docs, verified 2026-06-28.

## 2026-06-28 — Stable names for aria-pressed password toggles

**Learning:** ARIA toggle buttons expose state through `aria-pressed`; changing the accessible name at the same time can make assistive technology announcements harder to understand, and visible-text toggles must still satisfy WCAG label-in-name expectations.
**Action:** Keep password-visibility toggle names stable, bind `aria-pressed` to the visibility state, make any visible toggle text static when an `aria-label` overrides it, and use field-specific labels when multiple password toggles share one form.
**Source:** WAI-ARIA APG toggle button guidance / WCAG 2.5.3 and 4.1.2, verified 2026-06-29.

## 2026-07-01 — Stable password-toggle name regression assertions

**Learning:** When a password toggle uses `aria-pressed`, tests should assert both the state transition and the stable accessible name so future visible/icon refactors do not regress the APG toggle-button contract.
**Action:** Keep `aria-label="Show password"` stable across visibility toggles, bind `aria-pressed` to the current state, and hide decorative Eye/EyeOff icons from assistive technologies when the button already has an explicit accessible name.
**Source:** WAI-ARIA APG button pattern, verified 2026-07-01.
## 2025-02-23 — Use assertive live regions for React Native alert roles
**Learning:** In React Native, `accessibilityRole="alert"` corresponds to the assertive live region behavior. The value `"status"` is not a valid `accessibilityRole`.
**Action:** When adding error feedback banners, use `accessibilityRole="alert"` and `accessibilityLiveRegion="assertive"`. Do not use `"status"`.
**Source:** Codebase standards for dynamic error feedback
