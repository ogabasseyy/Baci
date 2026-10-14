'use client';
import type { CartMergeResolution, CartSnapshot } from '@baci/shared/cart';
import { useEffect, useRef, useState } from 'react';
import type { CartAccountLinkInput } from '@/schemas/cart-account';
import {
  fetchSavedAccountCart,
  linkAccountCart,
} from './shared-cart-account-client';
import { getCartSessionGeneration } from './shared-cart-storage';

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
  const [savedCart, setSavedCart] = useState<CartSnapshot | null>(null);
  const [status, setStatus] = useState<AccountLinkStatus>('idle');
  const [pending, setPending] = useState(false);
  const state = useRef({
    options,
    savedCart,
    pending: null as CartAccountLinkInput | null,
    scope: '',
  });
  const scope = JSON.stringify([
    options.merchantSlug,
    options.ownerSubject,
    getCartSessionGeneration(),
  ]);
  if (state.current.scope !== scope) {
    state.current.pending = null;
    state.current.scope = scope;
  }
  state.current.options = options;
  state.current.savedCart = savedCart;
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
      setStatus('loading');
      const result = await fetchSavedAccountCart(
        state.current.options.merchantSlug
      );
      if (
        state.current.scope !== captured ||
        getCartSessionGeneration() !== generation
      )
        return;
      if (!result.ok) {
        setStatus('error');
        return;
      }
      setSavedCart(result.cart);
      setStatus('ready');
    };
    const send = async (input: CartAccountLinkInput): Promise<boolean> => {
      const captured = state.current.scope;
      const generation = getCartSessionGeneration();
      const merchant = state.current.options.merchantSlug;
      setStatus('linking');
      const result = await linkAccountCart(input, merchant);
      if (
        state.current.scope !== captured ||
        getCartSessionGeneration() !== generation
      )
        return false;
      if (!result.ok) {
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
        if (!state.current.options.ownerSubject) {
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
  useEffect(() => {
    setSavedCart(null);
    setStatus('idle');
    setPending(false);
    return () => {
      if (state.current.scope === scope) state.current.scope = 'disposed';
    };
  }, [scope]);
  return { ...actions.current, savedCart, status, pending };
}
