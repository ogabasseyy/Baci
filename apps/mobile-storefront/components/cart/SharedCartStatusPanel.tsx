import type { CartItemIdentity } from '@baci/shared/cart';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

function conflictKey(item: CartItemIdentity): string {
  return JSON.stringify(item);
}
export function SharedCartStatusPanel() {
  const state = useNativeSharedCartStore();
  const colors = Colors[useColorScheme() ?? 'light'];
  const [picks, setPicks] = useState<Record<string, 'incoming' | 'existing'>>(
    {}
  );
  // Offer picks belong to one conflict cycle: when the conflict set or
  // the underlying cart changes, stale picks must not pre-arm Combine
  // for offers the shopper has not reviewed in this cycle.
  useEffect(() => {
    setPicks({});
  }, [state.mergeConflicts, state.snapshot?.cartId, state.snapshot?.version]);
  if (!state.enabled) return null;
  const busy = state.status === 'loading' || state.status === 'pending';
  if (
    state.status === 'ready' &&
    state.snapshot &&
    state.metadataReady &&
    state.mergeConflicts.length === 0
  )
    return null;
  function run(operation: (() => Promise<void>) | null): void {
    if (operation) void operation().catch(() => undefined);
  }
  const conflicts = state.mergeConflicts;
  const allPicked =
    conflicts.length > 0 && conflicts.every((item) => picks[conflictKey(item)]);
  return (
    <View
      style={[styles.panel, { backgroundColor: colors.background }]}
      accessibilityLiveRegion="polite"
    >
      {busy ? (
        <ActivityIndicator
          accessibilityLabel="Syncing cart"
          color={colors.primary}
        />
      ) : null}
      <Text style={{ color: colors.text }}>
        {state.status === 'choice_required'
          ? 'You have a saved cart and items on this device. Choose which cart to use.'
          : state.status === 'error'
            ? 'Cart sync was interrupted. Your last confirmed items are saved.'
            : !state.snapshot
              ? 'Connect these items to your shared cart before checkout.'
              : 'Checking product details before checkout.'}
      </Text>
      {!busy && conflicts.length > 0 && state.chooseLegacy ? (
        <>
          <Text style={{ color: colors.text }}>
            Some items have different offers in each cart. Choose which offer to
            keep for each item, then combine.
          </Text>
          {conflicts.map((item) => (
            <View key={conflictKey(item)}>
              <Text style={{ color: colors.text }}>
                Item {item.productId}
                {item.variantId ? ` (${item.variantId})` : ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setPicks((current) => ({
                    ...current,
                    [conflictKey(item)]: 'existing',
                  }))
                }
              >
                <Text style={{ color: colors.primary }}>
                  {picks[conflictKey(item)] === 'existing'
                    ? 'Keeping saved offer'
                    : 'Keep saved offer'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setPicks((current) => ({
                    ...current,
                    [conflictKey(item)]: 'incoming',
                  }))
                }
              >
                <Text style={{ color: colors.primary }}>
                  {picks[conflictKey(item)] === 'incoming'
                    ? 'Keeping device offer'
                    : 'Keep device offer'}
                </Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={!allPicked}
            onPress={() =>
              run(
                state.chooseLegacy
                  ? () =>
                      state.chooseLegacy?.(
                        'merge',
                        conflicts.map((item) => ({
                          item,
                          keep: picks[conflictKey(item)],
                        }))
                      ) ?? Promise.resolve()
                  : null
              )
            }
          >
            <Text style={{ color: colors.primary }}>
              Combine with my choices
            </Text>
          </Pressable>
        </>
      ) : null}
      {!busy && state.status === 'choice_required' && conflicts.length === 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              run(
                state.chooseLegacy
                  ? () => state.chooseLegacy?.('merge') ?? Promise.resolve()
                  : null
              )
            }
          >
            <Text style={{ color: colors.primary }}>Combine carts</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              run(
                state.chooseLegacy
                  ? () =>
                      state.chooseLegacy?.('keep_server') ?? Promise.resolve()
                  : null
              )
            }
          >
            <Text style={{ color: colors.primary }}>Use saved cart</Text>
          </Pressable>
        </>
      ) : !busy ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            run(
              state.snapshot || state.status === 'error'
                ? state.refresh
                : state.prepare
            )
          }
        >
          <Text style={{ color: colors.primary }}>
            {state.snapshot || state.status === 'error'
              ? 'Retry sync'
              : 'Connect cart'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({ panel: { padding: 16, gap: 12 } });
