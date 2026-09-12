import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { useTheme } from '@/hooks/useTheme';
import { RedvaultCheckoutSchema } from '@/schemas/redvault-checkout';
import type { OrderResponse } from '@/services/orders';
import {
  initializeRedvaultCheckout,
  RedvaultInitializationError,
} from './initialize-redvault-checkout';
import { RedvaultPaymentChoice } from './RedvaultPaymentChoice';

export interface RedvaultReviewInput {
  orderResponse: OrderResponse;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
}

export function RedvaultOrderReview({
  input,
  onClose,
}: {
  input: RedvaultReviewInput | null;
  onClose: () => void;
}) {
  return input ? (
    <RedvaultOrderReviewContent
      key={input.orderResponse.order.id}
      input={input}
      onClose={onClose}
    />
  ) : null;
}

function RedvaultOrderReviewContent({
  input,
  onClose,
}: {
  input: RedvaultReviewInput;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const checkout = RedvaultCheckoutSchema.safeParse(input.orderResponse);
  if (!checkout.success) return null;
  const quote = checkout.data.redvault.quote;
  const eligible = quote.discount_kobo > 0;
  const close = () => {
    active.current = false;
    if (inFlight.current) {
      router.replace('/orders');
      return;
    }
    onClose();
  };
  const start = async () => {
    if (inFlight.current || !eligible) return;
    inFlight.current = true;
    setStatus('pending');
    try {
      const result = await initializeRedvaultCheckout(
        input,
        () => active.current
      );
      if (!active.current) return;
      if (result === 'ready') onClose();
    } catch (error) {
      if (!active.current) return;
      if (
        error instanceof RedvaultInitializationError &&
        error.kind === 'definitive'
      ) {
        inFlight.current = false;
        setStatus('error');
        return;
      }
      setStatus('pending');
    }
  };
  return (
    <ModalSheet
      animationType="slide"
      backdropStyle={{ backgroundColor: colors.background }}
      cardStyle={{ flex: 1 }}
      onRequestClose={close}
      visible
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text style={{ color: colors.text }}>Review your UBA order</Text>
          <RedvaultPaymentChoice
            available
            selected
            status={status}
            onSelect={() => undefined}
            summary={{
              eligible,
              mixedBasket: quote.mixed_basket,
              productSubtotalKobo: quote.product_subtotal_kobo,
              eligibleSubtotalKobo: quote.eligible_subtotal_kobo,
              ineligibleSubtotalKobo: quote.ineligible_subtotal_kobo,
              discountKobo: quote.discount_kobo,
              taxAmountKobo: quote.tax_kobo,
              shippingFeeKobo: quote.shipping_kobo,
              giftWrappingFeeKobo: quote.gift_wrapping_kobo,
              payableTotalKobo: quote.payable_kobo,
            }}
          />
          {status !== 'pending' && eligible ? (
            <Pressable accessibilityRole="button" onPress={start}>
              <Text style={{ color: colors.primary }}>
                {status === 'error'
                  ? 'Try secure UBA payment again'
                  : 'Continue to secure UBA payment'}
              </Text>
            </Pressable>
          ) : status === 'pending' ? (
            <Text accessibilityRole="alert" style={{ color: colors.text }}>
              Payment initialization needs confirmation. This does not confirm a
              charge. Do not start another payment; check your orders.
            </Text>
          ) : null}
          <Pressable accessibilityRole="button" onPress={close}>
            <Text style={{ color: colors.primary }}>
              {status === 'pending'
                ? 'Check your orders'
                : 'Choose another payment method'}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ModalSheet>
  );
}
