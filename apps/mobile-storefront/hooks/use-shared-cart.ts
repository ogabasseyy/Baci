import * as Crypto from 'expo-crypto';
import { useEffect, useRef } from 'react';
import { fetchProductRow, transformProduct } from '@/hooks/product-utils';
import { createNativeCartController } from '@/lib/cart/controller';
import type { CartProductShell } from '@/lib/cart/display';
import {
  bindControllerActions,
  createEnrollmentTransition,
  DISABLED_SHARED_CART_STATE,
  markEnrollmentEnabled,
  reportInitialRefreshFailure,
  retireEnrollmentSession,
  retireLegacySharedCart,
} from '@/lib/cart/enrollment-transition';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import { clearMatchingCartPairingLink } from '@/lib/cart/pairing-link';
import { pendingCartRequest } from '@/lib/cart/pending-request';
import { cartSessionStorage } from '@/lib/cart/session-storage';
import {
  createNativeCartClient,
  type NativeCartClient,
  type NativeCartConfig,
} from '@/lib/cart/shared-cart-client';
import { startSharedCartPolling } from '@/lib/cart/shared-cart-polling';
import { getCartShopperToken } from '@/lib/cart/shopper-token';
import { mintedCheckoutGenerations } from '@/lib/minted-checkout-generations';
import { persistCheckoutGenerationDetached } from '@/lib/persist-checkout-generation';
import { releaseCheckoutCreditSnapshot } from '@/lib/release-checkout-credit-snapshot';
import { releaseCodepointCheckoutItemSort } from '@/lib/release-codepoint-checkout-item-sort';
import { getSession } from '@/lib/supabase';
import { useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import {
  installSharedCartWriter,
  sharedCartWriterGeneration,
} from '@/stores/shared-cart-writer';

interface Options extends NativeCartConfig {
  enabled: boolean;
  accountsEnabled?: boolean;
  subjectKey: string;
}
interface Deps {
  client(
    config: NativeCartConfig,
    isCurrent: () => boolean
  ): Pick<
    NativeCartClient,
    'context' | 'bootstrap' | 'read' | 'create' | 'command' | 'recoverCreation'
  > &
    Partial<
      Pick<
        NativeCartClient,
        | 'redeem'
        | 'recoverHandoff'
        | 'previewHandoff'
        | 'retireDevice'
        | 'recoverAccountLink'
        | 'linkAccount'
        | 'savedAccountCart'
        | 'prepareCheckout'
        | 'restartSession'
      >
    >;
  loadProduct(
    merchantId: string,
    productId: string
  ): Promise<CartProductShell | null>;
  receipts: typeof pendingCartRequest;
}
const defaults: Deps = {
  client: (config, isCurrent) =>
    createNativeCartClient(config, undefined, undefined, isCurrent, () =>
      getCartShopperToken(config.ownerSubject, getSession)
    ),
  receipts: pendingCartRequest,
  loadProduct: async (merchantId, productId) => {
    const { data, error } = await fetchProductRow(
      merchantId,
      productId,
      'Shared cart'
    );
    if (error || !data) return null;
    return transformProduct(data);
  },
};
export function useSharedCart(options: Options, deps: Deps = defaults): void {
  const latest = useRef(options);
  const enrollmentTransition = useRef(createEnrollmentTransition());
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    if (!options.enabled) {
      // Enrollment off: discard canonical ownership and retire the session.
      void retireEnrollmentSession(
        enrollmentTransition.current,
        options.merchantId,
        (merchantId) => cartSessionStorage.remove(merchantId)
      );
      retireLegacySharedCart({
        getLegacy: () => useCartStore.getState(),
        clearLegacy: (checkoutGeneration) =>
          useCartStore.setState({
            items: [],
            sharedCartRef: undefined,
            checkoutGeneration,
          }),
        mintGeneration: () =>
          mintedCheckoutGenerations.register(Crypto.randomUUID()),
        persistGeneration: persistCheckoutGenerationDetached,
        releaseGeneration: (generation) => {
          void releaseCheckoutCreditSnapshot(generation);
          void releaseCodepointCheckoutItemSort(generation);
        },
      });
      return;
    }
    markEnrollmentEnabled(enrollmentTransition.current);
    let alive = true;
    let generation = sharedCartWriterGeneration();
    const isCurrent = () =>
      alive &&
      sharedCartWriterGeneration() === generation &&
      latest.current.enabled &&
      latest.current.merchantId === options.merchantId &&
      latest.current.merchantSlug === options.merchantSlug &&
      latest.current.apiOrigin === options.apiOrigin &&
      latest.current.subjectKey === options.subjectKey;
    useNativeSharedCartStore.setState({
      enabled: true,
      accountsEnabled: options.accountsEnabled ?? false,
      status: 'loading',
      snapshot: null,
      metadataReady: false,
      mergeConflicts: [],
      mergeConflictReason: undefined,
      code: undefined,
      savedCart: null,
    });
    let controller: ReturnType<typeof createNativeCartController> | null = null;
    let retireDevice: (() => Promise<void>) | undefined;
    const release = installSharedCartWriter({
      retire: async () => {
        alive = false;
        if (retireDevice) {
          try {
            await retireDevice();
          } catch (error) {
            if (
              !(error instanceof NativeCartError) ||
              error.code !== 'revocation_pending'
            )
              throw error;
            const pending = await deps.receipts.read(options.merchantId);
            if (pending)
              await deps.receipts.clear(
                options.merchantId,
                pending.operationId
              );
            throw error;
          }
          const pending = await deps.receipts.read(options.merchantId);
          if (pending)
            await deps.receipts.clear(options.merchantId, pending.operationId);
        }
      },
      write: (action) => {
        if (!controller) return Promise.reject(new Error('Cart unavailable'));
        return controller.write(action);
      },
      onError: () => {
        if (!alive) return;
        useCartStore.setState({ isLoading: false });
        if (useNativeSharedCartStore.getState().status !== 'choice_required')
          useNativeSharedCartStore.setState({ status: 'error' });
      },
    });
    generation = sharedCartWriterGeneration();
    try {
      const client = deps.client(
        {
          merchantId: options.merchantId,
          merchantSlug: options.merchantSlug,
          apiOrigin: options.apiOrigin,
          ownerSubject:
            options.subjectKey === 'guest' ? undefined : options.subjectKey,
        },
        isCurrent
      );
      retireDevice = client.retireDevice;
      controller = createNativeCartController({
        merchantId: options.merchantId,
        getOwnerSubject: () =>
          options.subjectKey === 'guest' ? null : options.subjectKey,
        client,
        receipts: deps.receipts,
        isCurrent,
        onHandoffCommitted: clearMatchingCartPairingLink,
        onMergeConflicts: (items, reason) => {
          if (isCurrent())
            useNativeSharedCartStore.setState({
              mergeConflicts: items,
              mergeConflictReason: reason,
            });
        },
        newOperationId: () => Crypto.randomUUID(),
        getLegacy: () => useCartStore.getState(),
        repairLegacy: (items) => {
          if (isCurrent())
            useCartStore.setState({ items, sharedCartRef: undefined });
        },
        loadProduct: deps.loadProduct,
        status: (status, code) => {
          if (!isCurrent()) return;
          useCartStore.setState({
            isLoading: status === 'loading' || status === 'pending',
          });
          useNativeSharedCartStore.setState({ status, code });
        },
        publish: (snapshot, display) => {
          if (!isCurrent()) return;
          const previous = useCartStore.getState();
          const changedCart =
            previous.sharedCartRef?.merchantId !== snapshot.merchantId ||
            previous.sharedCartRef.cartId !== snapshot.cartId;
          const checkoutGeneration = changedCart
            ? mintedCheckoutGenerations.register(Crypto.randomUUID())
            : previous.checkoutGeneration;
          if (changedCart)
            persistCheckoutGenerationDetached(checkoutGeneration);
          useCartStore.setState({
            items: display.items,
            sharedCartRef: {
              merchantId: snapshot.merchantId,
              cartId: snapshot.cartId,
            },
            checkoutGeneration,
            cartWideNegotiationActive: false,
          });
          useNativeSharedCartStore.setState({
            snapshot,
            metadataReady: display.metadataReady,
            checkoutReview: changedCart
              ? null
              : useNativeSharedCartStore.getState().checkoutReview,
          });
        },
      });
      bindControllerActions(
        controller,
        isCurrent,
        useNativeSharedCartStore.setState
      );
      void controller.refresh().catch((error: unknown) =>
        reportInitialRefreshFailure(error, {
          isCurrent,
          hasSnapshot: () =>
            Boolean(useNativeSharedCartStore.getState().snapshot),
          clearLoading: () => useCartStore.setState({ isLoading: false }),
          setError: (code) =>
            useNativeSharedCartStore.setState({ status: 'error', code }),
          errorCode: (failure) =>
            failure instanceof NativeCartError ? failure.code : undefined,
        })
      );
    } catch {
      useCartStore.setState({ isLoading: false });
      useNativeSharedCartStore.setState({
        status: 'error',
        code: 'invalid_configuration',
      });
    }
    const stopPolling = startSharedCartPolling({
      getController: () => controller,
      hasSnapshot: () =>
        Boolean(useNativeSharedCartStore.getState().snapshot?.cartId),
    });
    return () => {
      alive = false;
      stopPolling();
      release();
      useCartStore.setState({ isLoading: false });
      useNativeSharedCartStore.setState({ ...DISABLED_SHARED_CART_STATE });
    };
  }, [
    options.enabled,
    options.accountsEnabled,
    options.merchantId,
    options.merchantSlug,
    options.apiOrigin,
    options.subjectKey,
    deps,
  ]);
}
