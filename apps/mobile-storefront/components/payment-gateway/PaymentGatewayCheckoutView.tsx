import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import type { ComponentProps, ComponentType, RefObject } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { paymentGatewayStyles as styles } from '@/components/payment-gateway/payment-gateway.styles';
import type Colors from '@/constants/Colors';
import { BRAND, withAlpha } from '@/constants/Colors';
import { PAYMENT_CLIPBOARD_BRIDGE } from '@/constants/payment-clipboard-bridge';

const PAYMENT_AMOUNT_FORMATTER = new Intl.NumberFormat('en-NG', {
  currency: 'NGN',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: 'currency',
});

interface PaymentGatewayCheckoutViewProps {
  amount?: number;
  authorizationUrl?: string;
  colors: typeof Colors.light;
  gatewayName: string;
  // Primary launches ride this view on loading/ready with the URL in
  // navigation params; when it is absent the operation is still saved
  // server-side, so primary overrides the dead-end fallback with
  // funding-safe copy instead of the generic missing-URL message.
  missingUrlMessage?: string;
  onClose: () => void;
  onError: NonNullable<ComponentProps<typeof WebView>['onError']>;
  onLoadEnd: () => void;
  onLoadStart: () => void;
  onMessage: NonNullable<ComponentProps<typeof WebView>['onMessage']>;
  onNavigationStateChange: NonNullable<
    ComponentProps<typeof WebView>['onNavigationStateChange']
  >;
  onShouldStartLoadWithRequest: NonNullable<
    ComponentProps<typeof WebView>['onShouldStartLoadWithRequest']
  >;
  status: 'loading' | 'ready' | 'processing' | 'success' | 'error';
  ToastComponent: ComponentType;
  webViewRef: RefObject<WebView | null>;
}

export function PaymentGatewayCheckoutView({
  amount,
  authorizationUrl,
  colors,
  gatewayName,
  missingUrlMessage,
  onClose,
  onError,
  onLoadEnd,
  onLoadStart,
  onMessage,
  onNavigationStateChange,
  onShouldStartLoadWithRequest,
  status,
  ToastComponent,
  webViewRef,
}: PaymentGatewayCheckoutViewProps) {
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Close payment checkout"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          ),
          headerShown: true,
          title: gatewayName,
        }}
      />

      {status === 'loading' ? (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingCard, { backgroundColor: colors.card }]}>
            <ActivityIndicator
              accessible={true}
              accessibilityLabel={`Loading ${gatewayName} checkout`}
              accessibilityRole="progressbar"
              size="large"
              color={BRAND.primary}
            />
            <Text style={[styles.loadingText, { color: colors.text }]}>
              Loading {gatewayName}...
            </Text>
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.securityBadge,
          { backgroundColor: withAlpha(BRAND.primary, 0.063) },
        ]}
      >
        <Ionicons name="shield-checkmark" size={16} color={BRAND.primary} />
        <Text style={[styles.securityText, { color: BRAND.primary }]}>
          Secure {gatewayName} Checkout
        </Text>
      </View>

      {authorizationUrl ? (
        <WebView
          ref={webViewRef}
          source={{ uri: authorizationUrl }}
          style={styles.webView}
          onLoadStart={onLoadStart}
          onLoadEnd={onLoadEnd}
          onNavigationStateChange={onNavigationStateChange}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={
            PAYMENT_CLIPBOARD_BRIDGE.script
          }
          injectedJavaScript={PAYMENT_CLIPBOARD_BRIDGE.script}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          injectedJavaScriptForMainFrameOnly={false}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          scalesPageToFit={Platform.OS === 'android'}
          mixedContentMode="never"
          onError={onError}
          renderLoading={() => (
            <View
              style={[
                styles.webViewLoading,
                { backgroundColor: colors.background },
              ]}
            >
              <ActivityIndicator
                accessible={true}
                accessibilityLabel={`Loading ${gatewayName} checkout`}
                accessibilityRole="progressbar"
                size="large"
                color={BRAND.primary}
              />
            </View>
          )}
        />
      ) : (
        <View style={styles.centeredContainer}>
          <Text style={[styles.statusMessage, { color: colors.textSecondary }]}>
            {missingUrlMessage ?? 'Checkout URL is missing.'}
          </Text>
        </View>
      )}

      {amount != null ? (
        <View
          style={[
            styles.amountBanner,
            { backgroundColor: colors.card, borderTopColor: colors.border },
          ]}
        >
          <Text style={[styles.amountLabel, { color: colors.textSecondary }]}>
            Total Amount
          </Text>
          <Text style={[styles.amountValue, { color: BRAND.primary }]}>
            {PAYMENT_AMOUNT_FORMATTER.format(amount)}
          </Text>
        </View>
      ) : null}

      <ToastComponent />
    </View>
  );
}
