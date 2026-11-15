import Ionicons from '@react-native-vector-icons/ionicons';
import { Redirect, Stack } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { useColorScheme } from '@/components/useColorScheme';
import { IdentityConfirmPanel } from '@/components/wallet/identity/IdentityConfirmPanel';
import { WalletPinDots } from '@/components/wallet/savings/WalletPinDots';
import { WalletPinPad } from '@/components/wallet/savings/WalletPinPad';
import Colors from '@/constants/Colors';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import { useWalletPinSettings } from './use-wallet-pin-settings';
import { useWalletPinSteps } from './use-wallet-pin-steps';
import { WalletPinSavedView } from './WalletPinSavedView';
import { styles } from './WalletPinSettingsScreen.styles';
import { walletPinStepCopy } from './wallet-pin-step-copy';

export function WalletPinSettingsScreen() {
  const colors = Colors[useColorScheme()];
  const { getScrollContentStyle } = useStorefrontInsets();
  const auth = useRequireAuth();
  const pin = useWalletPinSettings();
  const steps = useWalletPinSteps(pin);
  // Back from "Choose a new PIN" or "Confirm" returns to the previous step.
  // Never while signing out: the guard would also block the auth redirect.
  usePreventRemove(
    steps.canGoBack && !pin.savedTitle && !auth.redirectTo,
    steps.back
  );

  if (auth.redirectTo) return <Redirect href={auth.redirectTo} />;

  const title = <Stack.Screen options={{ title: 'Wallet PIN' }} />;
  // A confirmed save stays on screen even while (or if) the background
  // status refresh re-checks or fails: it never bounces to a spinner or out.
  const keepSaved = Boolean(pin.savedTitle);
  if (!keepSaved && (auth.isLoading || pin.gateState === 'checking')) {
    return (
      <StorefrontScreenShell
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: colors.background },
        ]}
        edges={['bottom']}
      >
        {title}
        <ActivityIndicator
          accessibilityLabel="Checking your wallet PIN"
          color={colors.primary}
        />
      </StorefrontScreenShell>
    );
  }

  if (!keepSaved && pin.gateState === 'off')
    return <Redirect href="/settings" />;

  const copy = walletPinStepCopy(pin.mode, steps.stage);
  let content: ReactNode;
  if (pin.savedTitle) {
    content = (
      <WalletPinSavedView
        colors={colors}
        title={pin.savedTitle}
        onDone={pin.finish}
      />
    );
  } else if (pin.needsIdentity) {
    content = (
      <View style={styles.identity}>
        <IdentityConfirmPanel
          colors={colors}
          expectedUserId={pin.userId ?? undefined}
          onConfirmed={pin.identityConfirmed}
        />
      </View>
    );
  } else {
    content = (
      <>
        <View style={styles.top}>
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.primaryLowOpacity },
            ]}
          >
            <Ionicons name="lock-closed" size={24} color={colors.primary} />
          </View>
          <Text
            accessibilityRole="header"
            style={[styles.title, styles.center, { color: colors.text }]}
          >
            {copy.title}
          </Text>
          {copy.hint ? (
            <Text
              style={[
                styles.body,
                styles.center,
                { color: colors.textSecondary },
              ]}
            >
              {copy.hint}
            </Text>
          ) : null}
          <View style={styles.dots}>
            <WalletPinDots
              colors={colors}
              label={copy.title}
              length={steps.value.length}
            />
          </View>
          {pin.error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.message, styles.center, { color: colors.error }]}
            >
              {pin.error}
            </Text>
          ) : null}
          {steps.stage === 'current' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Forgot your PIN?"
              disabled={pin.busy}
              onPress={steps.forgot}
              style={styles.secondary}
            >
              <Text style={[styles.secondaryText, { color: colors.primary }]}>
                Forgot your PIN?
              </Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.bottom}>
          <WalletPinPad
            colors={colors}
            disabled={pin.busy}
            value={steps.value}
            onChange={steps.setValue}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.action}
            accessibilityState={{ disabled: !steps.ready, busy: pin.busy }}
            disabled={!steps.ready}
            onPress={steps.advance}
            style={[
              styles.primary,
              {
                backgroundColor: steps.ready ? colors.primary : colors.muted,
              },
            ]}
          >
            {pin.busy ? (
              <ActivityIndicator
                color={colors.primaryForeground}
                size="small"
              />
            ) : (
              <Text
                style={[
                  styles.primaryText,
                  {
                    color: steps.ready
                      ? colors.primaryForeground
                      : colors.textSecondary,
                  },
                ]}
              >
                {copy.action}
              </Text>
            )}
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <StorefrontScreenShell
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      {title}
      <AppKeyboardAwareScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.scroll,
          getScrollContentStyle({ includeBottomInset: false }),
        ]}
      >
        {content}
      </AppKeyboardAwareScrollView>
    </StorefrontScreenShell>
  );
}
