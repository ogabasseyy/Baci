import { router, Stack, useIsFocused } from 'expo-router';
import {
  type ComponentRef,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AddressSuggestionsProvider } from '@/components/ui/address-suggestions-portal';
import { oxygenLinkedCustomerPrefill } from '@/services/oxygen/customer-prefill';
import { OxygenClientError } from '@/services/oxygen/errors';
import { oxygenNativeSession } from '@/services/oxygen/native-session';
import { readOwnedOxygenOrder } from '@/services/oxygen/owned-order';
import { useAuthStore } from '@/stores/auth-store';
import { OxygenActionFooterProvider } from './OxygenActionFooter';
import { OxygenApplicationLoading } from './OxygenApplicationLoading';
import { OxygenCheckoutWorkflow } from './OxygenCheckoutWorkflow';
import { OxygenDrawingControl } from './OxygenDrawingControl';
import { useOxygenColors } from './OxygenFormPrimitives';
import type { OxygenFields } from './oxygen-form-utils';
import { OxygenAction } from './oxygen-presentation';

type NativeSession = ReturnType<typeof oxygenNativeSession>;
export function OxygenCheckoutScreen({ orderId }: { orderId: string }) {
  const userId = useAuthStore((s) => s.user?.id);
  const customerId = useAuthStore((s) => s.customer?.id);
  const page = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  return (
    <AddressSuggestionsProvider
      onRequestSpace={(amount) =>
        page.current?.scrollTo({ y: offset.current + amount, animated: true })
      }
    >
      <CheckoutSession
        key={`${userId}:${customerId}:${orderId}`}
        orderId={orderId}
        scrollRef={page}
        onScrollOffset={(value) => {
          offset.current = value;
        }}
      />
    </AddressSuggestionsProvider>
  );
}
function CheckoutSession({
  orderId,
  scrollRef,
  onScrollOffset,
}: {
  orderId: string;
  scrollRef: RefObject<ComponentRef<typeof ScrollView> | null>;
  onScrollOffset: (value: number) => void;
}) {
  const colors = useOxygenColors();
  const focused = useIsFocused();
  const [setDrawing] = useState(
    () => (drawing: boolean) =>
      scrollRef.current?.setNativeProps({ scrollEnabled: !drawing })
  );
  const [context, setContext] = useState<{
    session: NativeSession;
    total: number;
    orderNumber?: string;
    orderPaymentStatus: string;
    prefill?: OxygenFields;
  } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is an explicit user retry trigger.
  useEffect(() => {
    let live = true;
    setError('');
    void (async () => {
      const session = oxygenNativeSession();
      await session.capabilities(false).catch((failure: unknown) => {
        if (
          failure instanceof OxygenClientError &&
          (failure.code === 'transport' || failure.status === 503)
        )
          return null;
        throw failure;
      });
      const customerId = useAuthStore.getState().customer?.id;
      if (!customerId)
        throw new Error('Sign in with your linked customer account.');
      const order = await readOwnedOxygenOrder(
        orderId,
        customerId,
        session.profile.merchantId
      );
      if (live)
        setContext({
          session,
          total: order.total,
          orderNumber: order.order_number ?? undefined,
          orderPaymentStatus: order.payment_status,
          prefill: oxygenLinkedCustomerPrefill(
            useAuthStore.getState().customer,
            {
              userId: session.userId,
              customerId,
              merchantId: session.profile.merchantId,
            },
            order.prefill
          ),
        });
    })().catch(() => {
      if (live)
        setError(
          'Could not load your saved Oxygen order. Check your account and connection.'
        );
    });
    return () => {
      live = false;
    };
  }, [orderId, attempt]);
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Screen
        options={{
          title: 'Oxygen',
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />
      <OxygenActionFooterProvider>
        <OxygenDrawingControl value={setDrawing}>
          <ScrollView
            ref={scrollRef}
            onScroll={(event) =>
              onScrollOffset(event.nativeEvent.contentOffset.y)
            }
            scrollEventThrottle={16}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, padding: 20, gap: 16 }}
          >
            {error ? (
              <>
                <Text accessibilityRole="alert" style={{ color: colors.text }}>
                  {error}
                </Text>
                <OxygenAction
                  label="Try again"
                  onPress={() => setAttempt((n) => n + 1)}
                />
              </>
            ) : context && focused ? (
              <OxygenCheckoutWorkflow orderId={orderId} context={context} />
            ) : context ? null : (
              <OxygenApplicationLoading />
            )}
            {error ? (
              <OxygenAction
                label="View my orders"
                secondary
                onPress={() => router.push('/orders')}
              />
            ) : null}
          </ScrollView>
        </OxygenDrawingControl>
      </OxygenActionFooterProvider>
    </SafeAreaView>
  );
}
