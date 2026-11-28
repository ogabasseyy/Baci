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
  deferWorkspace?: boolean;
  colors: ThemeColors;
  items: OrderDetailsItem[];
  formatPrice: (amount: number) => string;
}

export function PaidOrderChangeItems({
  orderId,
  merchantId,
  deferWorkspace,
  colors,
  items,
  formatPrice,
}: Props) {
  const [open, setOpen] = useState(false);
  const amendment = usePaidOrderAmendment(orderId, merchantId, deferWorkspace);
  const canOpen = Boolean(
    amendment.pending ||
      amendment.pendingUnreadable ||
      (amendment.canStart && items.length)
  );
  const summary = amendment.summary;
  const canRetryWorkspace = amendment.workspaceError && !deferWorkspace;
  if (!canOpen && !summary && !open && !canRetryWorkspace) return null;

  return (
    <View style={{ marginBottom: 12, gap: 8 }}>
      {canRetryWorkspace && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.text, paddingHorizontal: 12 }}>
            Item changes could not load.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void amendment.refreshOrder()}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: 12,
            }}
          >
            <Text style={{ color: colors.primary, fontWeight: '600' }}>
              Retry item changes
            </Text>
          </Pressable>
        </View>
      )}
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
          workspaceFresh={amendment.workspaceFresh}
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
