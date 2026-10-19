import type { Order } from '@baci/shared';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useCheckoutShippingRecovery } from '@/hooks/orders/useCheckoutShippingRecovery';
import { useTheme } from '@/hooks/useTheme';
import { checkoutRecoveryInitialStreet } from '@/lib/checkout-recovery-initial-street';
import { getOrderGiglInitialAddress } from '@/lib/order-shipment';
import { CheckoutRecoveryAddressInput } from './CheckoutRecoveryAddressInput';

export function CheckoutRecoveryForm({
  order,
  onBlockingChange,
  onBusyChange,
  onConfirmed,
}: {
  order: Order;
  onConfirmed?: () => void;
  onBlockingChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  const initialAddress = getOrderGiglInitialAddress(order);
  const recovery = useCheckoutShippingRecovery(order.id, {
    address: checkoutRecoveryInitialStreet(order.shipping_address),
    city: initialAddress.city ?? '',
    state: initialAddress.state ?? '',
    countryCode: '',
    phone: initialAddress.phone ?? '',
    latitude: '',
    longitude: '',
  });
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (recovery.confirmed) onConfirmed?.();
  }, [recovery.confirmed, onConfirmed]);
  useEffect(() => {
    onBusyChange(recovery.busy);
    return () => onBusyChange(false);
  }, [recovery.busy, onBusyChange]);
  useEffect(() => {
    onBlockingChange(!recovery.confirmed || recovery.busy);
    return () => onBlockingChange(false);
  }, [recovery.confirmed, recovery.busy, onBlockingChange]);
  const update = (changes: Parameters<typeof recovery.update>[0]) => {
    if (recovery.busy) return;
    setAccepted(false);
    recovery.update(changes);
  };
  const fee = (value: number) =>
    `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
  return (
    <View style={{ gap: 10, padding: 12 }}>
      <Text style={{ color: colors.text }}>
        Confirm the customer's delivery destination and pin. A preview does not
        book or charge.
      </Text>
      <CheckoutRecoveryAddressInput
        address={recovery.draft.address}
        disabled={recovery.busy}
        onSelect={update}
        onSearchChange={(address) =>
          update({
            address,
            city: '',
            state: '',
            countryCode: '',
            latitude: '',
            longitude: '',
          })
        }
      />
      {(
        ['address', 'city', 'state', 'phone', 'latitude', 'longitude'] as const
      ).map((field) => (
        <View key={field}>
          <Text style={{ color: colors.textSecondary }}>
            {field === 'latitude'
              ? 'Latitude (confirmed pin)'
              : field === 'longitude'
                ? 'Longitude (confirmed pin)'
                : field.charAt(0).toUpperCase() + field.slice(1)}
          </Text>
          <TextInput
            accessibilityLabel={`Recovery ${field}`}
            editable={!recovery.busy}
            value={recovery.draft[field]}
            onChangeText={(value) =>
              update(
                field === 'address' || field === 'city' || field === 'state'
                  ? {
                      [field]: value,
                      countryCode: '',
                      latitude: '',
                      longitude: '',
                    }
                  : { [field]: value }
              )
            }
            keyboardType={
              field === 'phone'
                ? 'phone-pad'
                : field === 'latitude' || field === 'longitude'
                  ? 'numbers-and-punctuation'
                  : 'default'
            }
            style={{
              color: colors.text,
              borderColor: colors.border,
              borderWidth: 1,
              padding: 10,
              borderRadius: 8,
            }}
          />
        </View>
      ))}
      <Text style={{ color: colors.textSecondary }}>
        Enter a verified pin manually if address search is unavailable. Pins
        from the saved quote are never filled automatically.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: recovery.busy }}
        disabled={recovery.busy}
        onPress={() => {
          setAccepted(false);
          void recovery.requestPreview();
        }}
      >
        <Text style={{ color: colors.primary }}>
          {recovery.busy ? 'Please wait…' : 'Preview new shipping quote'}
        </Text>
      </Pressable>
      {recovery.preview ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text }}>
            Paid shipping: {fee(recovery.preview.paidShippingFee)}
          </Text>
          <Text style={{ color: colors.text }}>
            New quote: {fee(recovery.preview.quote.price)} ·{' '}
            {recovery.preview.quote.displayName}
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            Estimated delivery: {recovery.preview.quote.estimatedDays}{' '}
            {recovery.preview.quote.estimatedDays === 1 ? 'day' : 'days'}
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            Expires:{' '}
            {new Date(recovery.preview.quote.expiresAt).toLocaleString(
              undefined,
              { dateStyle: 'medium', timeStyle: 'short' }
            )}
          </Text>
          {!recovery.preview.canConfirm ? (
            <Text accessibilityRole="alert" style={{ color: colors.text }}>
              {recovery.preview.error ??
                'This quote differs from the paid shipping amount. It cannot be confirmed here. Contact support to review this order.'}
            </Text>
          ) : (
            <>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: accepted,
                  disabled: recovery.busy,
                }}
                disabled={recovery.busy}
                onPress={() => setAccepted((value) => !value)}
              >
                <Text style={{ color: colors.text }}>
                  {accepted ? '☑' : '☐'} I confirmed this destination and pin
                  with the customer.
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !accepted || recovery.busy }}
                disabled={!accepted || recovery.busy}
                onPress={() => void recovery.confirm()}
              >
                <Text style={{ color: colors.primary }}>
                  Save confirmed destination and quote
                </Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
      {recovery.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {recovery.error}
        </Text>
      ) : null}
      {recovery.confirmed ? (
        <Text style={{ color: colors.text }}>
          Destination and quote saved. Use Book with GIG Logistics separately
          when ready.
        </Text>
      ) : null}
    </View>
  );
}
