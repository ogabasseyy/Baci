import type { Stack } from 'expo-router';
import type { ComponentProps } from 'react';

type RootStackScreenOptions = NonNullable<
  Extract<ComponentProps<typeof Stack>['screenOptions'], object>
>;

interface RootStackScreenOptionColors {
  background: string;
  text: string;
}

/**
 * Header policy for every screen in the root stack.
 *
 * - Back control: `minimal` shows only the chevron. The label-less native
 *   back button keeps the system accessibility label ("Back" / previous
 *   screen), so screen readers are unaffected. The previous behaviour
 *   (`headerBackTitle: ''`) is ignored by iOS, which then fell back to the
 *   previous screen's title and printed it next to the centered title.
 * - Header actions (gear, etc.) are never set here. A screen opts in with
 *   its own `headerRight`. Settings is reached from the Account tab menu row
 *   only; it has no header gear, and neither do Settings sub-screens or
 *   checkout / wallet / goal / payment flows.
 */
export function getRootStackScreenOptions({
  background,
  text,
}: RootStackScreenOptionColors): RootStackScreenOptions {
  return {
    // Suspend older covered routes without discarding state. Native-stack
    // keeps transition-adjacent Fabric screens live until it is safe to
    // freeze.
    freezeOnBlur: true,
    headerStyle: { backgroundColor: background },
    headerTintColor: text,
    headerTitleStyle: { fontWeight: '600' },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: background },
    animation: 'slide_from_right',
    gestureEnabled: true,
    gestureDirection: 'horizontal',
    headerBackButtonDisplayMode: 'minimal',
  };
}
