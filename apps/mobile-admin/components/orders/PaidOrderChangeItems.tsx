import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { usePaidOrderAmendment } from '@/hooks/orders/usePaidOrderAmendment';
import type { OrderDetailsItem } from './order-details.types';
import { PaidOrderChangeItemsSheet } from './PaidOrderChangeItemsSheet';
import { PaidOrderVerifiedSettlement } from './PaidOrderVerifiedSettlement';

interface Props {
  orderId: string;
  merchantId: string;
  colors: ThemeColors;
  items: OrderDetailsItem[];
  formatPrice: (amount: number) => string;
}

export function PaidOrderChangeItems({
  orderId,
  merchantId,
  colors,
  items,
  formatPrice,
}: Props) {
  const [open, setOpen] = useState(false);
  const amendment = usePaidOrderAmendment(orderId, merchantId);
  const canOpen = Boolean(
    amendment.pending || (amendment.canStart && items.length)
  );
  const summary = amendment.summary;
  if (!canOpen && !summary && !open) return null;

  return (
    <View style={{ marginBottom: 12, gap: 8 }}>
      {canOpen && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={{
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: 12,
          }}
        >
          <Text style={{ color: colors.primary, fontWeight: '600' }}>
            {amendment.pending ? 'Check item change' : 'Change items'}
          </Text>
        </Pressable>
      )}
      {summary && (
        <Text style={{ color: colors.text, paddingHorizontal: 12 }}>
          {summary.state === 'awaiting_payment'
            ? `Item change · ${formatPrice(summary.balanceDueMinor / 100)} due`
            : summary.state === 'awaiting_refund'
              ? `Item change · ${formatPrice(summary.refundOwedMinor / 100)} refund pending`
              : summary.state === 'settled'
                ? 'Item change settled'
                : summary.state === 'reversed'
                  ? 'Item change reversed'
                  : 'Item change cancelled'}
        </Text>
      )}
      {amendment.verification?.summary && amendment.operatorId && (
        <PaidOrderVerifiedSettlement
          orderId={orderId}
          amendmentId={amendment.verification.summary.amendmentId}
          operatorId={amendment.operatorId}
          verification={amendment.verification}
          colors={colors}
          refreshOrder={amendment.refreshOrder}
        />
      )}
      {open && (
        <PaidOrderChangeItemsSheet
          orderId={orderId}
          items={items}
          formatPrice={formatPrice}
          amendment={amendment}
          onClose={() => setOpen(false)}
        />
      )}
    </View>
  );
}
