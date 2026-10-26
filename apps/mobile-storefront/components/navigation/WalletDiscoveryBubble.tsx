import Ionicons from '@react-native-vector-icons/ionicons';
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { useWalletDiscoveryHint } from '@/hooks/use-wallet-discovery-hint';
import { CONFIG } from '@/lib/config';
import { useAuthStore } from '@/stores/auth-store';

export function WalletDiscoveryBubble({
  walletCenter,
  availableWidth,
  homeFocused,
}: {
  walletCenter: number;
  availableWidth: number;
  homeFocused: boolean;
}) {
  const pathname = usePathname();
  const { userId, customerUserId, merchantId, initialized } = useAuthStore(
    useShallow((state) => ({
      userId: state.user?.id,
      customerUserId: state.customer?.user_id,
      merchantId: state.merchantId || CONFIG.MERCHANT_ID,
      initialized: state.isInitialized,
    }))
  );
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive'
  );
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) =>
      setForeground(state === 'active')
    );
    return () => listener.remove();
  }, []);
  const enabled =
    homeFocused &&
    pathname === '/' &&
    foreground &&
    initialized &&
    !!userId &&
    (!customerUserId || customerUserId === userId);
  const hint = useWalletDiscoveryHint({ enabled, userId, merchantId });
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  if (!enabled || !hint.visible) return null;
  const width = Math.min(280, availableWidth - 16);
  const left = Math.max(
    8,
    Math.min(walletCenter - width * 0.75, availableWidth - width - 8)
  );
  const pointerLeft = Math.max(
    16,
    Math.min(walletCenter - left - 5, width - 24)
  );

  return (
    <View style={[styles.position, { left, width }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save towards your next device"
          accessibilityHint="Opens Wallet to start a savings plan"
          style={styles.action}
          onPress={() => {
            hint.dismiss();
            router.push('/wallet');
          }}
        >
          <Text style={[styles.text, { color: colors.text }]} numberOfLines={2}>
            Save towards your next device
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss savings tip"
          onPress={hint.dismiss}
          style={styles.close}
        >
          <Ionicons
            name="close"
            size={14}
            color={colors.textSecondary}
            accessible={false}
          />
        </Pressable>
      </View>
      <View style={[styles.pointer, { left: pointerLeft }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  position: { position: 'absolute', bottom: 72, zIndex: 2 },
  card: {
    borderWidth: 1,
    borderRadius: 22,
    paddingLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  action: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: { flex: 1, fontSize: 12, fontWeight: '500' },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointer: {
    position: 'absolute',
    bottom: -6,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: BRAND.primary,
  },
});
