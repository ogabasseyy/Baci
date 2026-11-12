import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { useColorScheme } from '@/components/useColorScheme';
import { IdentityConfirmPanel } from '@/components/wallet/identity/IdentityConfirmPanel';
import Colors from '@/constants/Colors';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import {
  useWalletPinSettings,
  type WalletPinMode,
} from './use-wallet-pin-settings';
import { WalletPinField } from './WalletPinField';
import { styles } from './WalletPinSettingsScreen.styles';

const COPY: Record<
  WalletPinMode,
  { title: string; body?: string; action: string }
> = {
  set: { title: 'Set a wallet PIN', action: 'Save PIN' },
  change: { title: 'Change your PIN', action: 'Change PIN' },
  reset: {
    title: 'Reset your PIN',
    body: 'Choose a new 4 to 6 digit PIN.',
    action: 'Reset PIN',
  },
};

export function WalletPinSettingsScreen() {
  const colors = Colors[useColorScheme()];
  const { getScrollContentStyle } = useStorefrontInsets();
  const auth = useRequireAuth();
  const pin = useWalletPinSettings();
  const copy = COPY[pin.mode];

  if (auth.redirectTo) return <Redirect href={auth.redirectTo} />;

  const title = <Stack.Screen options={{ title: 'Wallet PIN' }} />;
  if (auth.isLoading || pin.gateState === 'checking') {
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

  if (pin.gateState === 'off') return <Redirect href="/settings" />;

  const confirmLabel =
    pin.mode === 'change' ? 'Confirm new PIN' : 'Confirm PIN';
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
        {pin.needsIdentity ? (
          <View style={styles.identity}>
            <IdentityConfirmPanel
              colors={colors}
              expectedUserId={pin.userId ?? undefined}
              onConfirmed={pin.identityConfirmed}
            />
          </View>
        ) : (
          <>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.text }]}
            >
              {copy.title}
            </Text>
            {copy.body ? (
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                {copy.body}
              </Text>
            ) : null}
            {pin.mode === 'change' ? (
              <WalletPinField
                colors={colors}
                label="Current PIN"
                value={pin.currentPin}
                editable={!pin.busy}
                onChange={pin.setCurrentPin}
              />
            ) : null}
            <WalletPinField
              colors={colors}
              label="New PIN"
              value={pin.newPin}
              editable={!pin.busy}
              onChange={pin.setNewPin}
            />
            <WalletPinField
              colors={colors}
              label={confirmLabel}
              value={pin.confirmPin}
              editable={!pin.busy}
              onChange={pin.setConfirmPin}
            />
            {pin.error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.message, { color: colors.error }]}
              >
                {pin.error}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.action}
              accessibilityState={{ disabled: pin.busy }}
              disabled={pin.busy}
              onPress={pin.submit}
              style={[styles.primary, { backgroundColor: colors.primary }]}
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
                    { color: colors.primaryForeground },
                  ]}
                >
                  {copy.action}
                </Text>
              )}
            </Pressable>
            {pin.mode === 'change' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Forgot your PIN?"
                disabled={pin.busy}
                onPress={pin.forgotPin}
                style={styles.secondary}
              >
                <Text
                  style={[
                    styles.secondaryText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Forgot your PIN?
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </AppKeyboardAwareScrollView>
    </StorefrontScreenShell>
  );
}
