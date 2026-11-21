import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  OrderGiglFundingPoller,
  type OrderGiglPollContext,
} from '@/lib/order-gigl-funding-poller';
import { resolveOrderGiglQuoteFailure } from '@/lib/order-gigl-quote-failure';
import {
  getMerchantWalletSummary,
  type OrderGiglQuoteResult,
} from '@/lib/order-gigl-shipping';
import { bindOrderGiglShippingAppState } from '@/lib/order-gigl-shipping-app-state';
import {
  getOrderGiglAddressSignature,
  invalidateOrderGiglFundingQueries,
  type OrderGiglShippingParams,
  type OrderGiglShippingState,
  toCompleteOrderGiglReceiver,
  toOrderGiglWalletState,
} from '@/lib/order-gigl-shipping-state';
import { useOrderGiglAddressEditor } from './useOrderGiglAddressEditor';
import { useOrderGiglFunding } from './useOrderGiglFunding';
import { useOrderGiglQuoteRequester } from './useOrderGiglQuoteRequester';
import { useOrderGiglQuoteState } from './useOrderGiglQuoteState';

export type { OrderGiglShippingState } from '@/lib/order-gigl-shipping-state';

export function useOrderGiglShipping({
  enabled,
  initialAddress,
  orderId,
  preview = false,
  previewCacheScope,
  storedOrder,
}: OrderGiglShippingParams) {
  const queryClient = useQueryClient();
  const {
    applyQuote,
    invalidateQuote,
    isBoundTo,
    quote,
    confirm,
    resetConfirmation,
    quoteRef,
    setWallet,
    wallet,
    walletRef,
  } = useOrderGiglQuoteState();
  const addressEditor = useOrderGiglAddressEditor({
    initialAddress,
    orderId,
    preview,
    invalidateQuote,
  });
  const {
    addressDraft,
    addressRef,
    editingAddressRef,
    missingFields,
    setMissingFields,
  } = addressEditor;
  const canEditAddress = Boolean(
    storedOrder &&
      !storedOrder.selected_quote_id &&
      storedOrder.shipping_funding_source !== 'customer_checkout'
  );
  const requester = useOrderGiglQuoteRequester({
    addressRef,
    previewCacheScope,
    storedOrder,
  });
  const [state, setState] = useState<OrderGiglShippingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const initialAddressSignature = getOrderGiglAddressSignature(initialAddress);
  const controllerRef = useRef<AbortController | null>(null);
  const pollerRef = useRef<OrderGiglFundingPoller | null>(null);
  const enabledRef = useRef(enabled);
  const previewRef = useRef(preview);
  const appActiveRef = useRef(true);
  const orderIdRef = useRef(orderId);
  const requestQuoteRef = useRef<(() => Promise<unknown>) | null>(null);
  const {
    fundingAccount,
    refreshFundingAccount,
    reset: resetFunding,
    startFunding,
  } = useOrderGiglFunding({
    enabled: enabled && !preview,
    orderId,
    setError,
    setState,
  });
  enabledRef.current = enabled;
  previewRef.current = preview;
  const stopPolling = () => {
    pollerRef.current?.stop();
    pollerRef.current = null;
    controllerRef.current?.abort();
  };
  const applyQuoteResult = (result: OrderGiglQuoteResult, bound: boolean) => {
    applyQuote(result, bound ? requester.storedAddressSignature() : null);
    editingAddressRef.current = false;
    setMissingFields([]);
    setError(null);
    setState('ready');
  };
  const requestQuote = async (
    isValid: () => boolean = () => true,
    saveAddress = false
  ) => {
    if (!enabledRef.current || !orderId) return null;
    if (editingAddressRef.current && !saveAddress) return null;
    if (saveAddress && !toCompleteOrderGiglReceiver(addressRef.current)) {
      setError('Complete the delivery address and phone before saving.');
      return null;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('loading');
    setError(null);
    try {
      const bound = !previewRef.current;
      const result = await requester.fetch(
        orderId,
        !bound,
        controller.signal,
        saveAddress
      );
      if (!controller.signal.aborted && isValid()) {
        applyQuoteResult(result, bound);
        return result;
      }
    } catch (requestError: unknown) {
      if (controller.signal.aborted || !isValid()) return;
      const failure = resolveOrderGiglQuoteFailure(requestError);
      if (failure.kind === 'missing_address') {
        invalidateQuote();
        setMissingFields(failure.missing);
        setState('missing_address');
        return;
      }
      if (
        failure.kind === 'edit_address' &&
        canEditAddress &&
        !previewRef.current
      ) {
        openAddressEditor();
        setError(failure.message);
        return null;
      }
      setError(failure.message);
      setState('error');
    }
    return null;
  };
  requestQuoteRef.current = requestQuote;
  const openAddressEditor = () => {
    controllerRef.current?.abort();
    addressEditor.begin();
    setError(null);
    setState('missing_address');
  };
  const beginAddressEdit =
    canEditAddress && !preview ? openAddressEditor : undefined;
  const refreshBalance = async (context?: OrderGiglPollContext) => {
    const isCurrent = () =>
      !context ||
      (context.isCurrent() && enabledRef.current && appActiveRef.current);
    const summary = await getMerchantWalletSummary(context?.signal);
    if (!isCurrent()) return null;
    const price = quoteRef.current?.price ?? 0;
    const shortfall = Math.max(0, price - summary.availableBalance);
    const next = {
      availableBalance: summary.availableBalance,
      canBook: price > 0 && shortfall === 0,
      shortfall,
    };
    setWallet(next);
    if (next.canBook) {
      setWallet({ ...next, canBook: false });
      if (!isCurrent()) return null;
      const refreshed = await requestQuote(isCurrent);
      if (!isCurrent()) return null;
      if (refreshed?.canBook) {
        invalidateOrderGiglFundingQueries(queryClient, orderId);
      }
      return refreshed ? toOrderGiglWalletState(refreshed) : walletRef.current;
    }
    return next;
  };
  const startTransferPoll = () => {
    stopPolling();
    if (!enabledRef.current || !appActiveRef.current || !quoteRef.current)
      return;
    setState('polling');
    const poller = new OrderGiglFundingPoller(
      async (context) => {
        try {
          const next = await refreshBalance(context);
          return next?.canBook ? 'stop' : 'continue';
        } catch (pollError: unknown) {
          if (!context.isCurrent()) return 'stop';
          setError(
            pollError instanceof Error
              ? pollError.message
              : 'Unable to refresh wallet balance.'
          );
          setState('error');
          return 'stop';
        }
      },
      () => {
        if (enabledRef.current && appActiveRef.current) setState('ready');
      }
    );
    pollerRef.current = poller;
    poller.start();
  };
  const reset = () => {
    resetFunding();
    controllerRef.current?.abort();
    stopPolling();
    setError(null);
    setMissingFields([]);
    addressEditor.reset();
    setState('idle');
  };
  const clearOrderScopedState = () => {
    reset();
    invalidateQuote();
    requester.clear();
    resetConfirmation();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: orderId boundary
  useLayoutEffect(() => {
    if (orderIdRef.current === orderId) return;
    orderIdRef.current = orderId;
    clearOrderScopedState();
  }, [orderId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: render-local request
  useEffect(() => {
    // The order refetch after an address save carries the address the bound
    // quote was priced from: keep that quote instead of asking again.
    const keepBound =
      !preview && state === 'ready' && isBoundTo(initialAddressSignature);
    if (!enabled) reset();
    else if (!keepBound) {
      invalidateQuote();
      resetFunding();
      // A fresh background preview shows the price at once, with no request.
      const cached = preview ? requester.readCachedPreview(orderId) : null;
      if (cached) applyQuoteResult(cached, false);
      else void requestQuote();
    }
    return () => {
      controllerRef.current?.abort();
      stopPolling();
    };
  }, [enabled, initialAddressSignature, orderId, preview]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable stopPolling
  useEffect(() => {
    const subscription = bindOrderGiglShippingAppState({
      appActiveRef,
      enabledRef,
      quoteRef,
      requestQuoteRef,
      stopPolling,
      setState,
    });
    return () => subscription.remove();
  }, []);

  return {
    addressDraft,
    beginAddressEdit,
    error,
    ensureFreshQuoteForConfirmation: () =>
      confirm(previewRef.current, requestQuote),
    fundingAccount,
    missingFields,
    quote,
    refreshBalance,
    refreshFundingAccount,
    requestQuote: () => requestQuote(),
    saveAddressAndRequestQuote: () => requestQuote(undefined, true),
    reset,
    startFunding,
    startTransferPoll,
    state,
    selectAddressPlace: addressEditor.selectAddressPlace,
    updateAddressField: addressEditor.updateAddressField,
    wallet,
  };
}
