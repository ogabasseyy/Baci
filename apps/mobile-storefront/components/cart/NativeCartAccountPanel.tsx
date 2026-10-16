import { type CartMergeResolution, planCartMerge } from '@baci/shared/cart';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { NativeCartMergeConflicts } from './NativeCartMergeConflicts';
import { savedCartScopeMatches } from './saved-cart-scope';

/**
 * Explicit account choice for a signed-in shopper. Guest checkout never
 * requires this panel, and signing in alone never links the cart.
 */
export function NativeCartAccountPanel() {
  const accountUserId = useNativeSharedCartStore(
    (state) => state.accountUserId
  );
  const enabled = useNativeSharedCartStore((state) => state.enabled);
  const accountsEnabled = useNativeSharedCartStore(
    (state) => state.accountsEnabled
  );
  const linkAccount = useNativeSharedCartStore((state) => state.linkAccount);
  const loadSavedCart = useNativeSharedCartStore(
    (state) => state.loadSavedCart
  );
  const snapshot = useNativeSharedCartStore((state) => state.snapshot);
  const savedCart = useNativeSharedCartStore((state) => state.savedCart);
  const colors = Colors[useColorScheme() ?? 'light'];
  const operationRef = useRef<string | null>(null);
  // Owner-scoped flight guard: a stale attempt from a previous
  // account owner never blocks the new owner's first choice, and its
  // finally only clears its own scope.
  const inFlight = useRef<{
    userId: string | null;
    generation: number;
  } | null>(null);
  const pendingInput = useRef<
    Parameters<NonNullable<typeof linkAccount>>[0] | null
  >(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [picks, setPicks] = useState<CartMergeResolution[]>([]);
  const [savedRead, setSavedRead] = useState<{
    scope: { userId: string | null; generation: number } | null;
    status: 'loading' | 'ready' | 'error';
  }>({ scope: null, status: 'loading' });
  const [readRetry, setReadRetry] = useState(0);
  const userId = accountUserId;
  // Owner scope is state, not a ref: when the signed-in owner changes,
  // a render-phase state update advances the generation atomically
  // with the committed render, so a discarded concurrent render can
  // never advance the scope past a generation that was never shown.
  const [ownerScope, setOwnerScope] = useState({
    userId,
    generation: 0,
  });
  if (ownerScope.userId !== userId) {
    setOwnerScope({
      userId,
      generation: ownerScope.generation + 1,
    });
  }
  // Async completions compare against the last committed scope: the
  // ref only advances in an effect, never during render.
  const ownerScopeRef = useRef(ownerScope);
  useEffect(() => {
    ownerScopeRef.current = ownerScope;
  }, [ownerScope]);
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
    if (!userId || !loadSavedCart || !accountsEnabled) return;
    let active = true;
    const scope = ownerScope;
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
  }, [userId, loadSavedCart, accountsEnabled, readRetry, ownerScope]);
  if (!enabled || !accountsEnabled || !accountUserId || !linkAccount)
    return null;
  // Compare scopes by value, not reference: a recreated scope object
  // for the same owner and generation must not orphan a completed read.
  const savedReady =
    savedCartScopeMatches(savedRead.scope, ownerScope) &&
    savedRead.status === 'ready';
  const current = snapshot;
  const saved = savedCart;
  function operationId(): string {
    operationRef.current ??= Crypto.randomUUID();
    return operationRef.current;
  }
  async function run(
    input: Parameters<NonNullable<typeof linkAccount>>[0]
  ): Promise<void> {
    // The interacting render's scope governs the guard: the ref only
    // advances in a post-commit effect and can lag the render the
    // shopper is acting on. Completion checks below still compare
    // against the ref, which tracks the latest committed scope.
    const scope = ownerScope;
    if (inFlight.current === scope || (!pendingInput.current && !savedReady))
      return;
    inFlight.current = scope;
    pendingInput.current ??= JSON.parse(JSON.stringify(input)) as typeof input;
    setPending(true);
    try {
      await linkAccount?.(pendingInput.current);
      if (ownerScopeRef.current !== scope) return;
      pendingInput.current = null;
      setPending(false);
      operationRef.current = null;
      setNotice('Cart linked to your account.');
    } catch (error) {
      if (ownerScopeRef.current !== scope) return;
      // Any non-indeterminate error is definitive for this request:
      // the same choice can never succeed, so clear the pending
      // operation and offer a fresh choice instead of a doomed retry.
      if (error instanceof NativeCartError && !error.indeterminate) {
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
      if (inFlight.current === scope) inFlight.current = null;
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
      {savedCartScopeMatches(savedRead.scope, ownerScope) &&
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
          <NativeCartMergeConflicts
            conflicts={conflicts}
            colors={colors}
            disabled={pending || !savedReady}
            onPick={(pick) =>
              setPicks((existing) => [
                ...existing.filter(
                  (candidate) =>
                    JSON.stringify(candidate.item) !== JSON.stringify(pick.item)
                ),
                pick,
              ])
            }
          />
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
      {saved && !current ? (
        <>
          <Text style={{ color: colors.text }}>
            You have a saved account cart with {saved.lines.length} item(s).
          </Text>
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
        </>
      ) : null}
      {current ? (
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
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { padding: 16, gap: 12 },
  title: { fontSize: 16, fontWeight: '600' },
});
