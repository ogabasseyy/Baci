import { Stack } from 'expo-router';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from 'expo-router/react-navigation';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectivityBanner } from '@/components/ConnectivityBanner';
import { NativeCartPairingPanel } from '@/components/cart/NativeCartPairingPanel';
import { SharedCartBridge } from '@/components/cart/SharedCartBridge';
import { ChatWidget } from '@/components/chat/ChatWidget';
import { GlobalErrorBoundary } from '@/components/ErrorBoundary';
import { NegotiationModal } from '@/components/modals/NegotiationModal';
import { DrawerMenu } from '@/components/navigation/DrawerMenu';
import { NavigationBarStyleProvider } from '@/components/navigation/NavigationBarStyleProvider';
import { renderRootStackScreens } from '@/components/navigation/RootStackScreens';
import { RouteResumeController } from '@/components/navigation/RouteResumeController';
import AppKeyboardProvider from '@/components/ui/AppKeyboardProvider';
import { MobileUpdateController } from '@/components/updates/MobileUpdateController';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET } from '@/constants/layout';
import { useAuthGuard } from '@/hooks/use-auth-guard';
import { useRouteDiagnostics } from '@/hooks/use-route-diagnostics';
import { CONFIG } from '@/lib/config';
import { getOptionalGestureHandlerRuntime } from '@/lib/optional-gesture-handler';
import { QueryProvider } from '@/lib/QueryProvider';
import { getTemplateConfig } from '@/lib/templates';
import { AdTrackingRouteReadinessProvider } from '@/services/tiktok-product-route-tracking';

const OgabasseyLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: BRAND.primary,
    background: Colors.light.background,
    card: Colors.light.card,
    text: Colors.light.text,
    border: Colors.light.border,
  },
};

const OgabasseyDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: BRAND.primary,
    background: Colors.dark.background,
    card: Colors.dark.card,
    text: Colors.dark.text,
    border: Colors.dark.border,
  },
};

interface RootLayoutNavProps {
  adTrackingReady?: boolean;
  persistenceEnabled?: boolean;
  shouldResumeNavigation?: boolean;
}

export function RootLayoutNav({
  adTrackingReady = true,
  persistenceEnabled = true,
  shouldResumeNavigation = false,
}: RootLayoutNavProps) {
  const { GestureHandlerRootView } = getOptionalGestureHandlerRuntime();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const template = getTemplateConfig(CONFIG.BUSINESS_TYPE, CONFIG.TEMPLATE_ID);
  const enableConnectivityBanner =
    template.features?.connectivityBanner ?? true;
  const enableChatWidget = template.features?.chatWidget ?? true;
  const enableNegotiationModal = template.features?.negotiationModal ?? true;
  const enableDrawerMenu = template.features?.drawerMenu ?? true;
  const rootNavigationBarStyle = colorScheme === 'dark' ? 'light' : 'dark';

  // Auth guard handles sign out redirects before protected screens render.
  useAuthGuard();
  useRouteDiagnostics();

  return (
    <QueryProvider persistenceEnabled={persistenceEnabled}>
      <GestureHandlerRootView
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <NavigationBarStyleProvider rootStyle={rootNavigationBarStyle}>
          <SafeAreaProvider>
            <AppKeyboardProvider>
              <ThemeProvider
                value={
                  colorScheme === 'dark'
                    ? OgabasseyDarkTheme
                    : OgabasseyLightTheme
                }
              >
                <StatusBar
                  barStyle={
                    colorScheme === 'dark' ? 'light-content' : 'dark-content'
                  }
                />
                <View
                  style={[
                    styles.appShell,
                    { backgroundColor: colors.background },
                  ]}
                >
                  <GlobalErrorBoundary context="RootNavigation">
                    <AdTrackingRouteReadinessProvider ready={adTrackingReady}>
                      <RouteResumeController
                        shouldResume={shouldResumeNavigation}
                      />
                      <MobileUpdateController />
                      <SharedCartBridge />
                      <NativeCartPairingPanel />
                      {/*
                       * No custom `header` function in screenOptions — that would
                       * make react-native-screens NativeStack reserve a header zone
                       * via additionalSafeAreaInsets on every screen, even ones
                       * with `headerShown: false`, which combined with screens'
                       * own `<SafeAreaView edges={['top']}>` produced ~120pt of
                       * stacked blank padding above content. Mirrors apps/mobile-admin
                       * which uses the native iOS UINavigationBar.
                       *
                       * Screens that need a custom JS header can opt in
                       * per-Stack.Screen via `options.header`. Inner-content
                       * customization (back button, title node, right action) is
                       * available via `headerLeft`, `headerRight`, `headerTitle`
                       * without triggering the inset reservation.
                       */}
                      <Stack
                        screenOptions={{
                          headerStyle: {
                            backgroundColor: colors.background,
                          },
                          headerTintColor: colors.text,
                          headerTitleStyle: {
                            fontWeight: '600',
                          },
                          headerShadowVisible: false,
                          contentStyle: {
                            backgroundColor: colors.background,
                          },
                          animation: 'slide_from_right',
                          gestureEnabled: true,
                          gestureDirection: 'horizontal',
                          headerBackTitle: '',
                        }}
                      >
                        {renderRootStackScreens({
                          mutedContentBackgroundColor: colors.muted,
                        })}
                      </Stack>
                    </AdTrackingRouteReadinessProvider>
                  </GlobalErrorBoundary>
                  {enableConnectivityBanner ? <ConnectivityBanner /> : null}
                  {enableChatWidget ? (
                    <ChatWidget
                      bottomOffset={CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET}
                    />
                  ) : null}
                  {enableNegotiationModal ? <NegotiationModal /> : null}
                  {enableDrawerMenu ? <DrawerMenu /> : null}
                </View>
              </ThemeProvider>
            </AppKeyboardProvider>
          </SafeAreaProvider>
        </NavigationBarStyleProvider>
      </GestureHandlerRootView>
    </QueryProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appShell: { flex: 1 },
});
