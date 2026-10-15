import { type CartMergeResolution, planCartMerge } from '@baci/shared/cart';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

/**
 * Explicit account choice for a signed-in shopper. Guest checkout never
 * requires this panel, and signing in alone never links the cart.
 */
export function NativeCartAccountPanel() {
  const accountUserId = useNativeSharedCartStore(
    (state) => state.accountUserId
  );
  const state = useNativeSharedCartStore();
  const colors = Colors[useColorScheme() ?? 'light'];
  const operationRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const pendingInput = useRef<
    Parameters<NonNullable<typeof state.linkAccount>>[0] | null
  >(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [picks, setPicks] = useState<CartMergeResolution[]>([]);
  const [savedRead, setSavedRead] = useState<{
    scope: { userId: string | null; generation: number } | null;
    status: 'loading' | 'ready' | 'error';
  }>({ scope: null, status: 'loading' });
  const [readRetry, setReadRetry] = useState(0);
  const loadSavedCart = state.loadSavedCart;
  const userId = accountUserId;
  const ownerScope = useRef({ userId, generation: 0 });
  if (ownerScope.current.userId !== userId) {
    ownerScope.current = {
      userId,
      generation: ownerScope.current.generation + 1,
    };
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset pending UI whenever the authenticated owner changes.
  useEffect(() => {
    operationRef.current = null;
    pendingInput.current = null;
    setPending(false);
    setNotice(null);
    setPicks([]);
  }, [userId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the retry counter explicitly restarts a failed saved-cart read.
  useEffect(() => {
    if (!userId || !loadSavedCart || !state.accountsEnabled) return;
    let active = true;
    const scope = ownerScope.current;
    setSavedRead({ scope, status: 'loading' });
    setPicks([]);
    void loadSavedCart().then(
      () => {
        if (active) setSavedRead({ scope, status: 'ready' });
      },
      () => {
        if (active) setSavedRead({ scope, status: 'error' });
      }
    );
    return () => {
      active = false;
    };
  }, [userId, loadSavedCart, state.accountsEnabled, readRetry]);
  if (
    !state.enabled ||
    !state.accountsEnabled ||
    !accountUserId ||
    !state.linkAccount
  )
    return null;
  const savedReady =
    savedRead.scope === ownerScope.current && savedRead.status === 'ready';
  const current = state.snapshot;
  const saved = state.savedCart;
  function operationId(): string {
    operationRef.current ??= Crypto.randomUUID();
    return operationRef.current;
  }
  async function run(
    input: Parameters<NonNullable<typeof state.linkAccount>>[0]
  ): Promise<void> {
    if (inFlight.current || (!pendingInput.current && !savedReady)) return;
    const scope = ownerScope.current;
    inFlight.current = true;
    pendingInput.current ??= JSON.parse(JSON.stringify(input)) as typeof input;
    setPending(true);
    try {
      await state.linkAccount?.(pendingInput.current);
      if (ownerScope.current !== scope) return;
      pendingInput.current = null;
      setPending(false);
      operationRef.current = null;
      setNotice('Cart linked to your account.');
    } catch (error) {
      if (ownerScope.current !== scope) return;
      if (
        error instanceof NativeCartError &&
        !error.indeterminate &&
        [
          'invalid_item',
          'invalid_request',
          'merge_conflict',
          'version_conflict',
          'refresh_required',
        ].includes(error.code)
      ) {
        pendingInput.current = null;
        setPending(false);
        operationRef.current = null;
        setSavedRead({ scope, status: 'loading' });
        setPicks([]);
        setReadRetry((value) => value + 1);
        setNotice('Your carts changed. Review them and choose again.');
        return;
      }
      setNotice(
        'Linking was interrupted. Retry to finish with the same request.'
      );
    } finally {
      inFlight.current = false;
    }
  }
  const plan =
    current && saved && saved.cartId !== current.cartId
      ? planCartMerge(current, saved, picks)
      : null;
  const conflicts =
    plan && !plan.ok && plan.code === 'merge_conflict' ? plan.conflicts : [];
  return (
    <View
      style={[styles.panel, { backgroundColor: colors.background }]}
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.title, { color: colors.text }]}>
        Save this cart to your account
      </Text>
      {notice ? <Text style={{ color: colors.text }}>{notice}</Text> : null}
      {savedRead.scope === ownerScope.current &&
      savedRead.status === 'error' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setReadRetry((value) => value + 1)}
        >
          <Text style={{ color: colors.primary }}>
            Retry loading saved cart
          </Text>
        </Pressable>
      ) : null}
      {pending ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (pendingInput.current) void run(pendingInput.current);
          }}
        >
          <Text style={{ color: colors.primary }}>
            Retry the same cart choice
          </Text>
        </Pressable>
      ) : null}
      {saved && current && saved.cartId !== current.cartId ? (
        <>
          <Text style={{ color: colors.text }}>
            You also have a saved account cart with {saved.lines.length}{' '}
            item(s). Choose which cart to keep.
          </Text>
          {conflicts.map((conflict) => (
            <View key={JSON.stringify(conflict.item)}>
              <Text style={{ color: colors.text }}>
                Item {conflict.item.productId} has different offers in each
                cart.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={pending || !savedReady}
                onPress={() =>
                  setPicks((existing) => [
                    ...existing.filter(
                      (pick) =>
                        JSON.stringify(pick.item) !==
                        JSON.stringify(conflict.item)
                    ),
                    { item: conflict.item, keep: 'incoming' },
                  ])
                }
              >
                <Text style={{ color: colors.primary }}>Keep saved offer</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={pending || !savedReady}
                onPress={() =>
                  setPicks((existing) => [
                    ...existing.filter(
                      (pick) =>
                        JSON.stringify(pick.item) !==
                        JSON.stringify(conflict.item)
                    ),
                    { item: conflict.item, keep: 'existing' },
                  ])
                }
              >
                <Text style={{ color: colors.primary }}>
                  Keep this cart offer
                </Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={pending || !savedReady}
            onPress={() =>
              void run({
                operationId: operationId(),
                choice: 'use_saved',
                expectedSavedCartId: saved.cartId,
              })
            }
          >
            <Text style={{ color: colors.primary }}>Use saved cart</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={pending || !savedReady || !plan?.ok}
            onPress={() => {
              if (!plan?.ok) return;
              void run({
                operationId: operationId(),
                choice: 'merge',
                expectedSavedCartId: saved.cartId,
                expectedSavedVersion: saved.version,
                expectedCurrentVersion: current.version,
                lines: plan.lines,
                resolutions: picks,
              });
            }}
          >
            <Text style={{ color: colors.primary }}>Combine both carts</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={pending || !savedReady}
        onPress={() =>
          void run({
            operationId: operationId(),
            choice: 'keep_current',
            expectedSavedCartId: saved?.cartId ?? null,
          })
        }
      >
        <Text style={{ color: colors.primary }}>
          Keep this cart on my account
        </Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { padding: 16, gap: 12 },
  title: { fontSize: 16, fontWeight: '600' },
});
