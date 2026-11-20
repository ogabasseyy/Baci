import Ionicons from '@react-native-vector-icons/ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BNPLCheckoutStatusView } from '@/components/bnpl-checkout/BNPLCheckoutStatusView';
import { CHECKOUT_MERCHANT_DOMAIN } from '@/components/checkout/checkout-screen.constants';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { resolveApiBaseUrl } from '@/lib/api-url';
import { type BNPLRouteParams, normalizeBNPLRouteParams } from '@/lib/bnpl-url';
import { bnplCheckoutScreenStyles as styles } from './BNPLCheckoutScreen.styles';
import { BNPLCheckoutWebView } from './BNPLCheckoutWebView';
import { useBNPLCheckoutController } from './use-bnpl-checkout-controller';
import { useCameraPermission } from './use-camera-permission';

const API_BASE_URL = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL);
const CREDIT_DIRECT_CAMERA_PERMISSION_MESSAGE =
  'Camera access is required to complete Credit Direct identity verification. Enable camera permission and try again.';
const CREDIT_DIRECT_CAMERA_SETTINGS_MESSAGE =
  'Camera access is required to complete Credit Direct identity verification. Enable camera permission in device settings and return to checkout.';

function openAppSettings() {
  void Linking.openSettings().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[BNPLCheckout] Failed to open app settings', { message });
  });
}

export function BNPLCheckoutScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const rawParams = useLocalSearchParams<BNPLRouteParams>();
  const params = normalizeBNPLRouteParams(rawParams);
  const checkout = useBNPLCheckoutController({
    apiBaseUrl: API_BASE_URL,
    merchantDomain: CHECKOUT_MERCHANT_DOMAIN,
    params,
  });
  const requiresCameraPermission =
    checkout.validatedParams.isValid &&
    checkout.validatedParams.data?.gateway === 'credit_direct';
  const cameraPermission = useCameraPermission(requiresCameraPermission);
  const cameraPermissionStatus = cameraPermission.status;

  if (!checkout.validatedParams.isValid) {
    return (
      <BNPLCheckoutStatusView
        colors={colors}
        message={checkout.validatedParams.error}
        onBack={() => router.back()}
        variant="invalid"
      />
    );
  }

  if (checkout.status === 'success') {
    return (
      <BNPLCheckoutStatusView
        colors={colors}
        gatewayName={checkout.gatewayName}
        variant="success"
      />
    );
  }

  if (checkout.status === 'error') {
    return (
      <BNPLCheckoutStatusView
        colors={colors}
        gatewayName={checkout.gatewayName}
        message={checkout.errorMessage}
        onBack={checkout.handleClose}
        onRetry={checkout.handleRetry}
        variant="error"
      />
    );
  }

  if (requiresCameraPermission && cameraPermissionStatus === 'checking') {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top', 'left', 'right']}
      >
        <Stack.Screen
          options={{
            title: checkout.gatewayName,
            headerShown: true,
            headerLeft: () => (
              <Pressable
                accessibilityLabel="Close checkout"
                accessibilityRole="button"
                onPress={checkout.handleClose}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            ),
          }}
        />
        <View style={styles.permissionContainer}>
          <ActivityIndicator
            accessibilityLabel="Preparing camera access"
            size="large"
            color={colors.primary}
          />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Preparing {checkout.gatewayName}
          </Text>
          <Text
            style={[styles.loadingSubtext, { color: colors.textSecondary }]}
          >
            Camera access may be needed for identity verification.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (requiresCameraPermission && cameraPermissionStatus === 'denied') {
    return (
      <BNPLCheckoutStatusView
        colors={colors}
        gatewayName={checkout.gatewayName}
        message={
          cameraPermission.canAskAgain
            ? CREDIT_DIRECT_CAMERA_PERMISSION_MESSAGE
            : CREDIT_DIRECT_CAMERA_SETTINGS_MESSAGE
        }
        onBack={checkout.handleClose}
        onRetry={
          cameraPermission.canAskAgain
            ? cameraPermission.retry
            : openAppSettings
        }
        retryAccessibilityLabel={
          cameraPermission.canAskAgain ? undefined : 'Open app settings'
        }
        retryLabel={cameraPermission.canAskAgain ? undefined : 'Open Settings'}
        variant="error"
      />
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}
    >
      <Stack.Screen
        options={{
          title: checkout.gatewayName,
          headerShown: true,
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Close checkout"
              accessibilityRole="button"
              onPress={checkout.handleClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      <BNPLCheckoutWebView
        amount={checkout.amount}
        allowsMediaCapture={
          requiresCameraPermission && cameraPermissionStatus === 'granted'
        }
        bnplUrl={checkout.bnplUrl}
        colors={colors}
        currentUrl={checkout.currentUrl}
        gatewayName={checkout.gatewayName}
        onError={checkout.handleWebViewError}
        onHttpError={checkout.handleWebViewHttpError}
        onLoadEnd={checkout.handleLoadEnd}
        onLoadStart={checkout.handleLoadStart}
        onMessage={checkout.handleWebViewMessage}
        onNavigationStateChange={checkout.handleNavigationChange}
        onOpenWindow={checkout.handleOpenWindow}
        onShouldStartLoadWithRequest={checkout.handleShouldStartLoadWithRequest}
        status={checkout.status}
        webViewRef={checkout.webViewRef}
      />
    </SafeAreaView>
  );
}
