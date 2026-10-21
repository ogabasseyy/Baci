import { cartLineIdentity } from '@baci/shared/cart';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { EXPO_PUBLIC_API_URL, EXPO_PUBLIC_ROOT_DOMAIN } from '@/env';
import { resolveCartApiOrigin } from '@/lib/cart/api-origin';
import {
  cartPairingRevision,
  clearCartPairingLink,
  peekCartPairingLink,
  subscribeCartPairing,
} from '@/lib/cart/pairing-link';
import { createNativeCartClient } from '@/lib/cart/shared-cart-client';
import { CONFIG } from '@/lib/config';
import { useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { markSharedCartIntent } from '@/stores/shared-cart-writer';

export function NativeCartPairingPanel() {
  const revision = useSyncExternalStore(
    subscribeCartPairing,
    cartPairingRevision,
    cartPairingRevision
  );
  const [preview, setPreview] = useState({
    revision: -1,
    status: 'loading',
    count: 0,
  });
  const [retryTick, setRetryTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const [resolutions, setResolutions] = useState<
    Record<string, 'incoming' | 'existing'>
  >({});
  const shared = useNativeSharedCartStore();
  const items = useCartStore((state) => state.items);
  const colors = Colors[useColorScheme() ?? 'light'];
  const link = peekCartPairingLink();
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryTick intentionally re-triggers the preview check for the active revision.
  useEffect(() => {
    let alive = true;
    const current = peekCartPairingLink();
    setFailed(false);
    setResolutions({});
    if (!current) return;
    setPreview({ revision, status: 'loading', count: 0 });
    try {
      const client = createNativeCartClient({
        merchantId: CONFIG.MERCHANT_ID,
        merchantSlug: CONFIG.MERCHANT_SLUG,
        apiOrigin: resolveCartApiOrigin(
          EXPO_PUBLIC_API_URL,
          EXPO_PUBLIC_ROOT_DOMAIN
        ),
      });
      void client
        .previewHandoff(current.handoffId, current.token)
        .then((result) => {
          if (alive)
            setPreview({
              revision,
              status: 'ready',
              count: result.snapshot.lines.reduce(
                (sum, line) => sum + line.quantity,
                0
              ),
            });
        })
        .catch(() => {
          if (alive) setPreview({ revision, status: 'error', count: 0 });
        });
    } catch {
      setPreview({ revision, status: 'error', count: 0 });
    }
    return () => {
      alive = false;
    };
  }, [revision, retryTick]);
  if (!link) return null;
  const ready = preview.revision === revision && preview.status === 'ready';
  const busy = shared.status === 'loading' || shared.status === 'pending';
  async function pair(
    choice: 'connect' | 'merge' | 'keep_existing'
  ): Promise<void> {
    const current = peekCartPairingLink();
    if (
      !current ||
      !ready ||
      !shared.enabled ||
      !shared.pair ||
      cartPairingRevision() !== revision
    )
      return;
    markSharedCartIntent();
    try {
      await shared.pair(
        current,
        choice,
        shared.mergeConflicts.flatMap((item) => {
          const keep = resolutions[cartLineIdentity(item)];
          return keep ? [{ item, keep }] : [];
        })
      );
    } catch {
      setFailed(true);
    }
  }
  function dismissPairing(): void {
    clearCartPairingLink();
    // Pairing-published conflicts have no resolution path once the sheet
    // closes; legacy choice conflicts (status choice_required) stay gated.
    const state = useNativeSharedCartStore.getState();
    if (state.status !== 'choice_required' && state.mergeConflicts.length) {
      markSharedCartIntent();
      useNativeSharedCartStore.setState({
        mergeConflicts: [],
        mergeConflictReason: undefined,
      });
    }
  }
  async function browser(): Promise<void> {
    const current = peekCartPairingLink();
    if (
      current?.destination !== 'web' ||
      !ready ||
      cartPairingRevision() !== revision
    )
      return;
    markSharedCartIntent();
    try {
      await WebBrowser.openBrowserAsync(current.browserUrl);
    } catch {
      setFailed(true);
    }
  }
  function button(label: string, run: () => Promise<void>, disabled = false) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          void run();
        }}
        style={styles.button}
      >
        <Text style={{ color: colors.primary }}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <ModalSheet
      visible
      onRequestClose={dismissPairing}
      cardStyle={[styles.card, { backgroundColor: colors.background }]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        Continue with this cart
      </Text>
      {preview.status === 'loading' ? (
        <ActivityIndicator
          accessibilityLabel="Checking cart"
          color={colors.primary}
        />
      ) : null}
      <Text style={{ color: colors.text }}>
        {preview.status === 'error'
          ? 'This cart link could not be verified. Request a new link or try again later.'
          : ready
            ? `${preview.count} items are ready to review. Nothing will be ordered here.`
            : 'Checking your cart link.'}
      </Text>
      {preview.status === 'error'
        ? button('Try again', async () => setRetryTick((n) => n + 1))
        : null}
      {failed ? (
        <Text style={{ color: colors.text }}>
          The cart has not finished syncing. Retry sync to check the saved
          attempt.
        </Text>
      ) : null}
      {shared.mergeConflicts.length ? (
        <View>
          <Text style={{ color: colors.text }}>
            {shared.mergeConflictReason === 'duplicate_identity'
              ? 'Update duplicate voucher items in the original cart before combining.'
              : 'Choose which offer to keep for each item.'}
          </Text>
          {shared.mergeConflictReason !== 'duplicate_identity'
            ? shared.mergeConflicts.map((item) => {
                const key = cartLineIdentity(item);
                const name =
                  items.find(
                    (line) =>
                      line.product_id.toLowerCase() ===
                      item.productId.toLowerCase()
                  )?.name ?? 'Item';
                return (
                  <View key={key}>
                    <Text style={{ color: colors.text }}>{name}</Text>
                    {(['existing', 'incoming'] as const).map((keep) => (
                      <Pressable
                        key={keep}
                        accessibilityRole="radio"
                        accessibilityLabel={`${name}: ${keep === 'existing' ? 'keep current offer' : 'use incoming offer'}`}
                        accessibilityState={{
                          checked: resolutions[key] === keep,
                        }}
                        onPress={() => {
                          markSharedCartIntent();
                          setResolutions((previous) => ({
                            ...previous,
                            [key]: keep,
                          }));
                        }}
                        style={styles.button}
                      >
                        <Text style={{ color: colors.primary }}>
                          {keep === 'existing'
                            ? 'Keep current offer'
                            : 'Use incoming offer'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })
            : null}
        </View>
      ) : null}
      {ready && link.destination === 'web'
        ? button('Continue on website', browser)
        : null}
      {ready && link.destination === 'native' && !shared.enabled ? (
        <Text style={{ color: colors.text }}>
          This link needs a supported app. Ask for a website checkout link to
          continue in your browser.
        </Text>
      ) : null}
      {ready && link.destination === 'native' && shared.enabled ? (
        <>
          {items.length ? (
            <>
              {button(
                'Combine carts',
                () => pair('merge'),
                busy ||
                  shared.mergeConflictReason === 'duplicate_identity' ||
                  shared.mergeConflicts.some(
                    (item) => !resolutions[cartLineIdentity(item)]
                  )
              )}
              {button(
                'Keep my current cart',
                () => pair('keep_existing'),
                busy
              )}
            </>
          ) : (
            button('Connect cart', () => pair('connect'), busy)
          )}
          {failed && (shared.refresh || shared.prepare)
            ? button(
                'Retry sync',
                async () => {
                  markSharedCartIntent();
                  try {
                    // Mirror the status panel: a read-only refresh cannot
                    // create a missing canonical cart after a failed pair.
                    const preferred =
                      shared.snapshot || items.length === 0
                        ? shared.refresh
                        : shared.prepare;
                    const operation =
                      preferred ?? shared.prepare ?? shared.refresh;
                    await operation?.();
                    setFailed(false);
                  } catch {
                    setFailed(true);
                  }
                },
                busy
              )
            : null}
        </>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close cart link"
        onPress={dismissPairing}
        style={styles.button}
      >
        <Text style={{ color: colors.text }}>Close</Text>
      </Pressable>
    </ModalSheet>
  );
}
const styles = StyleSheet.create({
  card: {
    padding: 24,
    gap: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: { fontSize: 20, fontWeight: '600' },
  button: { paddingVertical: 12 },
});
