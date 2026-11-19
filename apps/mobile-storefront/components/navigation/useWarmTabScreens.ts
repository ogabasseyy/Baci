import type { BottomTabBarProps } from 'expo-router/js-tabs';

type WarmTabScreensOptions = {
  activeRouteName: string;
  navigateToTab: BottomTabBarProps['navigateToTab'];
  preloadProtectedTabs: boolean;
  routes: BottomTabBarProps['state']['routes'];
};

export function useWarmTabScreens(_options: WarmTabScreensOptions) {
  // Keep tab transitions cheap: routes warm themselves when visited instead of
  // mounting off-screen screens and their data effects from the tab chrome.
}
