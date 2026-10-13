import type { Order } from '@baci/shared';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useCheckoutShippingRecovery } from '@/hooks/orders/useCheckoutShippingRecovery';
import { useAuth } from '@/hooks/useAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { getOrderGiglInitialAddress } from '@/lib/order-shipment';
import { CheckoutRecoveryAddressInput } from './CheckoutRecoveryAddressInput';

function RecoveryForm({
  order,
  onBlockingChange,
  onBusyChange,
}: {
  order: Order;
  onBlockingChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  const initialAddress = getOrderGiglInitialAddress(order);
  const recovery = useCheckoutShippingRecovery(order.id, {
    address:
      initialAddress.address ?? order.shipping_address?.address_line1 ?? '',
    city: initialAddress.city ?? '',
    state: initialAddress.state ?? '',
    phone: initialAddress.phone ?? '',
    latitude: '',
    longitude: '',
  });
  const [accepted, setAccepted] = useState(false);
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
          update({ address, city: '', state: '', latitude: '', longitude: '' })
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
                : field}
          </Text>
          <TextInput
            accessibilityLabel={`Recovery ${field}`}
            editable={!recovery.busy}
            value={recovery.draft[field]}
            onChangeText={(value) =>
              update(
                field === 'address' || field === 'city' || field === 'state'
                  ? { [field]: value, latitude: '', longitude: '' }
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
        <RecoveryForm
          key={order.id}
          order={order}
          onBlockingChange={onBlockingChange}
          onBusyChange={setBusy}
        />
      ) : null}
    </View>
  );
}
