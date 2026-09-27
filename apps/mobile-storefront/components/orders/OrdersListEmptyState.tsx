import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdSlot } from '@/components/ads/AdSlot';
import { BRAND } from '@/constants/Colors';

interface OrdersListEmptyStateColors {
  text: string;
  textSecondary: string;
}

interface OrdersListEmptyStateProps {
  colors: OrdersListEmptyStateColors;
  hasOrders: boolean;
  onClearSearch: () => void;
  onStartShopping: () => void;
}

export function OrdersListEmptyState({
  colors,
  hasOrders,
  onClearSearch,
  onStartShopping,
}: OrdersListEmptyStateProps) {
  if (hasOrders) {
    return (
      <View style={styles.emptyState}>
        <Ionicons
          name="search-outline"
          size={64}
          color={colors.textSecondary}
        />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No matching orders
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Try searching with a different term
        </Text>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: BRAND.primary }]}
          onPress={onClearSearch}
          accessibilityRole="button"
          accessibilityLabel="Clear order search"
        >
          <Text style={styles.actionButtonText}>Clear Search</Text>
        </TouchableOpacity>
        <AdSlot placement="FOOTER_ANCHOR" />
      </View>
    );
  }

  return (
    <View style={styles.emptyState}>
      <Ionicons name="receipt-outline" size={64} color={colors.textSecondary} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No orders yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        When you place orders, they&apos;ll appear here
      </Text>
      <TouchableOpacity
        style={[styles.actionButton, { backgroundColor: BRAND.primary }]}
        onPress={onStartShopping}
        accessibilityRole="button"
        accessibilityLabel="Start shopping"
      >
        <Text style={styles.actionButtonText}>Start Shopping</Text>
      </TouchableOpacity>
      <AdSlot placement="FOOTER_ANCHOR" />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
  },
  actionButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 24,
  },
  actionButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
