import type { RealtimeChannel } from '@supabase/supabase-js';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import type { OrderDetailsInsurancePolicy } from '@/components/orders/OrderDetailsInsuranceCard';
import { SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';
import { useCancelOrder } from '@/hooks/use-cancel-order';
import { useReceiptPreview } from '@/hooks/use-receipt-preview';
import { useMerchantReceiptInfo } from '@/hooks/use-receipts';
import { createLogger } from '@/lib/logger';
import {
  BACI_GOOGLE_REVIEW_URL,
  CUSTOMER_CANCELLATION_REASONS,
} from '@/lib/post-purchase-actions';
import { supabase } from '@/lib/supabase';
import { isOrderRealtimePayload } from '@/lib/validation';
import { useAuthStore } from '@/stores/auth-store';
import type { OrderDetails } from './OrderDetailsScreen.types';
import { presentOrderCancellationPrompt } from './order-cancellation-prompt';
import { getOrderTrackingUrl } from './order-details.helpers';
import {
  fetchLatestInsurancePolicy,
  fetchOrderCanCancel,
  fetchOrderRecord,
} from './order-details-data';

const log = createLogger('OrderDetails');

export function useOrderDetailsController() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((state) => state.user);
  const customer = useAuthStore((state) => state.customer);
  const { data: merchantInfo } = useMerchantReceiptInfo();
  const receiptPreview = useReceiptPreview();
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [insurancePolicy, setInsurancePolicy] =
    useState<OrderDetailsInsurancePolicy | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const trackingChannelRef = useRef<RealtimeChannel | null>(null);
  const cancellation = useCancelOrder(id ?? '');
  const [cancelAttempted, setCancelAttempted] = useState(false);
  const conflictHandledRef = useRef(false);
  const refetch = () => setRefreshToken((token) => token + 1);
  // Derived during render instead of mirrored into state via an effect.
  const requiresSignIn = Boolean(id) && (!user?.id || !customer?.id);

  // Reset stale order/policy state during render (instead of inside the fetch
  // effect) so neither a new `id` nor a different signed-in identity ever shows
  // the previous order — or its insurance card — while the fetch is in flight.
  const resetKey = `${id ?? ''}|${user?.id ?? ''}|${customer?.id ?? ''}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setOrder(null);
    setInsurancePolicy(null);
    setCanCancel(false);
    setError(null);
    setIsLoading(Boolean(id) && Boolean(user?.id) && Boolean(customer?.id));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is intentionally unread — bumping it refetches the order without changing the query.
  useEffect(() => {
    if (!id) return;
    if (!user?.id || !customer?.id) return;

    let ignore = false;
    Promise.all([fetchOrderRecord(id, customer.id), fetchOrderCanCancel(id)])
      .then(([orderDetails, orderCanCancel]) => {
        if (ignore) return null;
        setOrder(orderDetails);
        setCanCancel(orderCanCancel);
        return fetchLatestInsurancePolicy(id);
      })
      .then((policy) => {
        if (ignore) return;
        if (policy) {
          setInsurancePolicy(policy);
        }
        setError(null);
      })
      .catch((err) => {
        if (ignore) return;
        log.error('Error fetching order:', err);
        setError('Failed to load order details');
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [id, user?.id, customer?.id, refreshToken]);

  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`order-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          log.debug('Order updated in realtime:', payload);
          if (!isOrderRealtimePayload(payload)) {
            log.warn('Invalid order realtime payload:', payload);
            return;
          }

          setOrder((prevOrder) =>
            prevOrder
              ? {
                  ...prevOrder,
                  shipping_status:
                    payload.new.shipping_status ?? prevOrder.shipping_status,
                  tracking_number:
                    payload.new.tracking_number ?? prevOrder.tracking_number,
                  shipping_provider:
                    payload.new.shipping_provider ??
                    prevOrder.shipping_provider,
                  updated_at: payload.new.updated_at ?? prevOrder.updated_at,
                }
              : prevOrder
          );
        }
      )
      .subscribe((status) => {
        log.debug('Realtime subscription status:', status);
      });

    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`order-tracking:${id}`, { config: { private: true } })
      .on('broadcast', { event: 'shipment_tracking_changed' }, () => {
        setRefreshToken((token) => token + 1);
      })
      .subscribe((status) => {
        log.debug('Tracking wakeup subscription status:', status);
      });

    trackingChannelRef.current = channel;
    return () => {
      if (trackingChannelRef.current) {
        supabase.removeChannel(trackingChannelRef.current);
        trackingChannelRef.current = null;
      }
    };
  }, [id]);

  // After a cancellation attempt the server can reject with a 409
  // (`order_not_cancellable`). When that happens, tell the customer the order can
  // no longer be cancelled and refetch so the CTA disappears.
  useEffect(() => {
    if (!cancelAttempted || !cancellation.notCancellable) return;
    if (conflictHandledRef.current) return;
    conflictHandledRef.current = true;
    setCanCancel(false);
    Alert.alert(
      'This order can no longer be cancelled',
      'It has already moved forward. We have refreshed the latest status for you.'
    );
    // Inlined setter (stable across renders) keeps the dependency list minimal.
    setRefreshToken((token) => token + 1);
  }, [cancelAttempted, cancellation.notCancellable]);

  const handleCancelOrder = () => {
    if (!canCancel || cancellation.isCancelling) return;

    presentOrderCancellationPrompt({
      onConfirm: (reason) => {
        conflictHandledRef.current = false;
        setCancelAttempted(true);
        cancellation
          .cancelOrder(reason)
          .then((cancelled) => {
            if (cancelled) {
              setCanCancel(false);
              refetch();
            }
          })
          .catch((err) => {
            const message =
              err instanceof Error && err.message
                ? err.message
                : 'Could not cancel this order. Please try again.';
            log.error('Unexpected cancellation failure:', err);
            Alert.alert('Could not cancel order', message);
          });
      },
      reasons: CUSTOMER_CANCELLATION_REASONS,
    });
  };

  const handleTrackOrder = () => {
    const trackingUrl = getOrderTrackingUrl(
      order?.tracking_number,
      order?.shipping_provider
    );

    if (!order?.tracking_number) {
      Alert.alert(
        'Tracking Unavailable',
        'No tracking information is available for this order yet.'
      );
      return;
    }

    if (trackingUrl) {
      Linking.openURL(trackingUrl);
      return;
    }

    Alert.alert(
      'Tracking Unavailable',
      'No tracking link is available for this shipping provider.'
    );
  };

  const handleContactSupport = () => {
    Linking.openURL(
      `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent('Hi, I need help with my order')}`
    );
  };

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/orders/index');
  };

  return {
    canCancel,
    error: requiresSignIn ? 'Please sign in to view order details' : error,
    handleCallRider: () => {
      const riderPhone = merchantInfo?.rider_phone_number?.trim();
      if (!riderPhone) {
        Alert.alert(
          'Rider Contact Unavailable',
          'The rider phone number has not been added yet.'
        );
        return;
      }
      Linking.openURL(`tel:${riderPhone}`);
    },
    handleCancelOrder,
    handleContactSupport,
    handleGoBack,
    handleLeaveGoogleReview: () => Linking.openURL(BACI_GOOGLE_REVIEW_URL),
    handleOpenProduct: (slug: string) => router.push(`/product/${slug}`),
    handleOpenReceipt: () =>
      order && receiptPreview.openPreviewByOrderId(order.id),
    handleReturnOrder: () => {
      Alert.alert(
        'Return Order',
        'In-app returns are coming next. For now, contact support to start a return for this order.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Contact Support', onPress: handleContactSupport },
        ]
      );
    },
    handleTrackOrder,
    insurancePolicy,
    isCancelling: cancellation.isCancelling,
    isLoading: requiresSignIn ? false : isLoading,
    merchantInfo,
    order,
    receiptPreview,
  };
}
