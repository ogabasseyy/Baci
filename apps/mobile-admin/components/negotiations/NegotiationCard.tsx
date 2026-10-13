import type { NegotiationCartLine, NegotiationItemInfo } from '@baci/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { palette } from '@/constants/Colors';
import { formatCurrency as formatPrice } from '@/utils/format';
import { formatNegotiationItemMeta } from './format-negotiation-item-meta';
import { negotiationCardStyles as styles } from './NegotiationCard.styles';
import { NegotiationCartSnapshot } from './NegotiationCartSnapshot';
import { NegotiationContactActions } from './NegotiationContactActions';
import { NegotiationDecisionControls } from './NegotiationDecisionControls';
import { NegotiationItemMetaChips } from './NegotiationItemMetaChips';

export type NegotiationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'countered';

export interface NegotiationCardRequest {
  id: string;
  customer_id: string | null;
  type: 'single' | 'total';
  status: NegotiationStatus;
  offered_price: number;
  current_price: number | null;
  item_info: NegotiationItemInfo | null;
  cart_snapshot: NegotiationCartLine[] | null;
  customer_email: string | null;
  customer_phone: string | null;
  created_at: string;
  evidence_url: string | null;
}

export interface NegotiationCardColors {
  backgroundLight: string;
  border: string;
  card: string;
  error: string;
  errorLight: string;
  primary: string;
  success: string;
  successLight: string;
  text: string;
  textOnPrimary: string;
  textSecondary: string;
  warning: string;
  warningLight: string;
}

interface NegotiationCardProps {
  actionLoading: boolean;
  actionsDisabled: boolean;
  colors: NegotiationCardColors;
  expanded: boolean;
  item: NegotiationCardRequest;
  onAction: (id: string, status: 'accepted' | 'rejected') => void;
  onOpenEvidence: (evidenceUrl: string) => void | Promise<void>;
  onOpenExternalUrl: (url: string) => void | Promise<void>;
  onToggleCart: (id: string) => void;
}

export function NegotiationCard({
  actionLoading,
  actionsDisabled,
  colors,
  expanded,
  item,
  onAction,
  onOpenEvidence,
  onOpenExternalUrl,
  onToggleCart,
}: NegotiationCardProps) {
  const itemMeta = formatNegotiationItemMeta(item.item_info);
  const evidenceUrl = item.evidence_url;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.typeBadge,
            {
              backgroundColor:
                item.type === 'total' ? palette.amber[100] : palette.red[50],
            },
          ]}
        >
          <Text
            style={[
              styles.typeText,
              {
                color:
                  item.type === 'total' ? palette.amber[700] : palette.red[700],
              },
            ]}
          >
            {item.type === 'total' ? 'Bulk Cart' : 'Single Item'}
          </Text>
        </View>
        <Text style={[styles.dateText, { color: colors.textSecondary }]}>
          {new Date(item.created_at).toLocaleDateString()}
        </Text>
      </View>

      <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
        {item.item_info?.name ?? 'Cart Negotiation'}
      </Text>
      {itemMeta ? (
        <NegotiationItemMetaChips colors={colors} metadata={itemMeta} />
      ) : null}

      <View
        style={[styles.priceRow, { backgroundColor: colors.backgroundLight }]}
      >
        {item.current_price != null && (
          <View>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Current
            </Text>
            <Text style={[styles.oldPrice, { color: colors.textSecondary }]}>
              {formatPrice(item.current_price)}
            </Text>
          </View>
        )}
        {item.current_price != null && (
          <Ionicons
            name="arrow-forward"
            size={16}
            color={colors.textSecondary}
          />
        )}
        <View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Offered
          </Text>
          <Text style={[styles.newPrice, { color: colors.primary }]}>
            {formatPrice(item.offered_price)}
          </Text>
        </View>
        {item.current_price != null &&
          item.current_price > 0 &&
          item.offered_price < item.current_price && (
            <View style={styles.savingsBadge}>
              <Text style={styles.savingsText}>
                -
                {Math.round(
                  (1 - item.offered_price / item.current_price) * 100
                )}
                %
              </Text>
            </View>
          )}
      </View>

      {item.cart_snapshot && item.cart_snapshot.length > 0 ? (
        <NegotiationCartSnapshot
          cartSnapshot={item.cart_snapshot}
          colors={colors}
          expanded={expanded}
          negotiationId={item.id}
          onToggleCart={onToggleCart}
        />
      ) : null}

      {evidenceUrl ? (
        <Pressable
          style={styles.evidenceButton}
          onPress={() => void onOpenEvidence(evidenceUrl)}
          accessibilityRole="button"
          accessibilityLabel="View customer evidence"
        >
          <Ionicons name="image-outline" size={16} color={colors.primary} />
          <Text style={[styles.evidenceText, { color: colors.primary }]}>
            View customer evidence
          </Text>
        </Pressable>
      ) : null}

      <NegotiationContactActions
        colors={colors}
        item={item}
        onOpenExternalUrl={onOpenExternalUrl}
      />

      <NegotiationDecisionControls
        actionLoading={actionLoading}
        actionsDisabled={actionsDisabled}
        colors={colors}
        itemId={item.id}
        onAction={onAction}
        status={item.status}
      />
    </View>
  );
}
