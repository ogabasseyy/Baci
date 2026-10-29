import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, SPACING, withAlpha } from '@/constants/Colors';
import { openWalletPaystackCheckout } from '@/lib/open-wallet-paystack-checkout';
import { paymentGatewayStyles as styles } from './payment-gateway.styles';
import { PAYMENT_LOAD_TIMEOUT_MESSAGE } from './payment-gateway-controller.helpers';

interface WalletCheckoutRecoveryViewProps {
  authorizationUrl: string;
  colors: typeof Colors.light;
  errorMessage: string | null;
  onBack: () => void;
  onCheck: () => void;
}

export function WalletCheckoutRecoveryView({
  authorizationUrl,
  colors,
  errorMessage,
  onBack,
  onCheck,
}: WalletCheckoutRecoveryViewProps) {
  const [opening, setOpening] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const openingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openCheckout = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setBrowserError(null);
    try {
      await openWalletPaystackCheckout(authorizationUrl);
    } catch {
      if (mountedRef.current) {
        setBrowserError(
          'Could not open Paystack. Check your funding status or try again.'
        );
      }
    } finally {
      openingRef.current = false;
      if (mountedRef.current) setOpening(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: 'Paystack',
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Close payment error"
              accessibilityRole="button"
              onPress={onBack}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: SPACING.xl,
        }}
      >
        <View
          style={[
            styles.statusIcon,
            { backgroundColor: withAlpha(colors.error, 0.125) },
          ]}
        >
          <Ionicons name="alert-circle" size={48} color={colors.error} />
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.statusTitle, { color: colors.text }]}
        >
          Wallet funding needs attention
        </Text>
        <Text style={[styles.statusMessage, { color: colors.textSecondary }]}>
          {errorMessage === PAYMENT_LOAD_TIMEOUT_MESSAGE
            ? 'Paystack checkout took too long to load.'
            : errorMessage || 'We could not check this funding.'}
        </Text>
        <Text style={[styles.statusMessage, { color: colors.textSecondary }]}>
          If you have already paid, check your funding status before trying
          again. Do not pay again while the payment is pending.
        </Text>
        {browserError ? (
          <Text
            accessibilityRole="alert"
            style={[styles.statusMessage, { color: colors.error }]}
          >
            {browserError}
          </Text>
        ) : null}
        <View style={styles.errorActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check funding status"
            disabled={opening}
            accessibilityState={{ disabled: opening }}
            style={[styles.baseButton, { backgroundColor: BRAND.primary }]}
            onPress={onCheck}
          >
            <Text style={styles.actionButtonText}>Check funding status</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Paystack in browser"
            accessibilityState={{ busy: opening, disabled: opening }}
            disabled={opening}
            style={[
              styles.baseButton,
              styles.secondaryButton,
              { borderColor: colors.border },
            ]}
            onPress={openCheckout}
          >
            {opening ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text
                style={[styles.secondaryButtonText, { color: colors.text }]}
              >
                Open Paystack in browser
              </Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={[
              styles.baseButton,
              styles.secondaryButton,
              { borderColor: colors.border },
            ]}
            onPress={onBack}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
              Go Back
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
