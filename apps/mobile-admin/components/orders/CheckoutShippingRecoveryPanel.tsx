import type { Order } from '@baci/shared';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { canUseCheckoutShippingRecovery } from '@/lib/checkout-shipping-recovery-eligibility';
import { CheckoutRecoveryForm } from './CheckoutRecoveryForm';

export function CheckoutShippingRecoveryPanel({
  order,
  onBlockingChange,
  onBusyChange,
  required = false,
  onConfirmed,
}: {
  order: Order;
  required?: boolean;
  onConfirmed?: () => void;
  onBlockingChange: (value: boolean) => void;
  onBusyChange?: (value: boolean) => void;
}) {
  const { user } = useAuth();
  const { merchant } = useMerchant();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (required) setOpen(true);
  }, [required]);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  if (!canUseCheckoutShippingRecovery(order, merchant, user?.id)) return null;
  return (
    <View>
      {required ? (
        <Text style={{ color: colors.text, padding: 12 }}>
          Review destination and shipping quote before booking.
        </Text>
      ) : (
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
      )}
      {open || required ? (
        <CheckoutRecoveryForm
          key={order.id}
          order={order}
          onConfirmed={onConfirmed}
          onBlockingChange={onBlockingChange}
          onBusyChange={setBusy}
        />
      ) : null}
    </View>
  );
}
