import type { Order } from '@baci/shared';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { CheckoutRecoveryForm } from './CheckoutRecoveryForm';

export function CheckoutShippingRecoveryPanel({
  order,
  onBlockingChange,
  onBusyChange,
}: {
  order: Order;
  onBlockingChange: (value: boolean) => void;
  onBusyChange?: (value: boolean) => void;
}) {
  const { user } = useAuth();
  const { merchant } = useMerchant();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  if (
    !user?.id ||
    merchant?.user_id !== user.id ||
    merchant.id !== order.merchant_id ||
    order.payment_status !== 'paid' ||
    order.shipping_status !== 'processing' ||
    order.shipping_funding_source !== 'customer_checkout' ||
    order.shipping_provider?.toUpperCase() !== 'GIGL' ||
    order.shipment_id ||
    order.tracking_number
  )
    return null;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        accessibilityState={{ disabled: busy }}
        onPress={() => setOpen((value) => !value)}
      >
        <Text style={{ color: colors.primary, padding: 12 }}>
          {open
            ? 'Cancel destination recovery'
            : 'Confirm destination and refresh paid quote'}
        </Text>
      </Pressable>
      {open ? (
        <CheckoutRecoveryForm
          key={order.id}
          order={order}
          onBlockingChange={onBlockingChange}
          onBusyChange={setBusy}
        />
      ) : null}
    </View>
  );
}
