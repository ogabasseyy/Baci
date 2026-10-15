'use client';
import type { CartMergeResolution, CartSnapshot } from '@baci/shared/cart';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CartAccountLinkInput } from '@/schemas/cart-account';
import {
  fetchSavedAccountCart,
  linkAccountCart,
} from './shared-cart-account-client';
import {
  getCartSessionGeneration,
  subscribeCartSessionGeneration,
} from './shared-cart-storage';

interface Options {
  merchantSlug?: string | null;
  ownerSubject?: string | null;
  onLinked?: () => Promise<void> | void;
}
export type AccountLinkStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'linking'
  | 'linked'
  | 'error';
type Merge = {
  lines: CartAccountLinkInput['lines'];
  resolutions?: CartMergeResolution[];
  expectedSavedVersion: number;
  expectedCurrentVersion: number;
};
/** Only an explicit choice links a cart. Unknown outcomes retain the exact request. */
export function useCartAccountLink(options: Options) {
  const generation = useSyncExternalStore(
    subscribeCartSessionGeneration,
    getCartSessionGeneration,
    getCartSessionGeneration
  );
  const [savedCart, setSavedCart] = useState<CartSnapshot | null>(null);
  const [status, setStatus] = useState<AccountLinkStatus>('idle');
  const [pending, setPending] = useState(false);
  const state = useRef({
    options,
    savedCart,
    pending: null as CartAccountLinkInput | null,
    scope: '',
    loadedScope: null as string | null,
    readRun: 0,
    lifecycle: 0,
  });
  const scope = JSON.stringify([
    options.merchantSlug,
    options.ownerSubject,
    generation,
  ]);
  if (state.current.scope !== scope) {
    state.current.pending = null;
    state.current.savedCart = null;
    state.current.loadedScope = null;
    state.current.readRun += 1;
    state.current.scope = scope;
  }
  state.current.options = options;

  const actions = useRef<{
    loadSavedCart: () => Promise<void>;
    link: (
      choice: CartAccountLinkInput['choice'],
      merge?: Merge
    ) => Promise<boolean>;
    retry: () => Promise<boolean>;
  } | null>(null);
  if (!actions.current) {
    const loadSavedCart = async () => {
      const captured = state.current.scope;
      const generation = getCartSessionGeneration();
      const run = ++state.current.readRun;
      state.current.loadedScope = null;
      state.current.savedCart = null;
      setSavedCart(null);
      setStatus('loading');
      if (!state.current.options.ownerSubject) {
        setStatus('error');
        return;
      }
      const result = await fetchSavedAccountCart(
        state.current.options.merchantSlug
      );
      if (
        state.current.scope !== captured ||
        getCartSessionGeneration() !== generation ||
        state.current.readRun !== run
      )
        return;
      if (!result.ok) {
        setStatus('error');
        return;
      }
      state.current.loadedScope = captured;
      state.current.savedCart = result.cart;
      setSavedCart(result.cart);
      setStatus('ready');
    };
    const send = async (input: CartAccountLinkInput): Promise<boolean> => {
      const captured = state.current.scope;
      const generation = getCartSessionGeneration();
      const lifecycle = state.current.lifecycle;
      const merchant = state.current.options.merchantSlug;
      setStatus('linking');
      const result = await linkAccountCart(input, merchant);
      if (
        state.current.scope !== captured ||
        getCartSessionGeneration() !== generation ||
        state.current.lifecycle !== lifecycle
      )
        return false;
      if (!result.ok) {
        state.current.loadedScope = null;
        if (!result.retryable) {
          state.current.pending = null;
          setPending(false);
        }
        setStatus('error');
        return false;
      }
      state.current.pending = null;
      setPending(false);
      setStatus('linked');
      await state.current.options.onLinked?.();
      if (
        state.current.scope === captured &&
        getCartSessionGeneration() === generation
      )
        await loadSavedCart();
      return true;
    };
    actions.current = {
      loadSavedCart,
      retry: () =>
        state.current.pending
          ? send(state.current.pending)
          : Promise.resolve(false),
      link: (choice, merge) => {
        if (
          !state.current.options.ownerSubject ||
          state.current.loadedScope !== state.current.scope ||
          state.current.pending
        ) {
          setStatus('error');
          return Promise.resolve(false);
        }
        if (!state.current.pending) {
          state.current.pending = structuredClone({
            operationId: crypto.randomUUID(),
            choice,
            // Every choice acknowledges the observed saved cart so a
            // stale observation refreshes instead of silently linking.
            expectedSavedCartId: state.current.savedCart?.cartId ?? null,
            ...(choice === 'merge' && merge ? merge : {}),
          });
          setPending(true);
        }
        return send(state.current.pending);
      },
    };
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each authority scope invalidates prior observations and async completions.
  useEffect(() => {
    setSavedCart(null);
    setStatus('idle');
    setPending(false);
    return () => {
      state.current.readRun += 1;
      state.current.lifecycle += 1;
    };
  }, [scope]);
  const savedCartLoaded =
    state.current.loadedScope === scope && status === 'ready';
  return {
    ...actions.current,
    scopeKey: scope,
    savedCart: state.current.loadedScope === scope ? savedCart : null,
    savedCartLoaded,
    status,
    pending,
  };
}
