import { StyleSheet } from 'react-native';

export const orderDetailsItemsStyles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  itemCondition: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  itemDetails: {
    flex: 1,
  },
  itemImage: {
    borderRadius: 12,
    height: 56,
    width: 56,
  },
  itemImagePlaceholder: {
    alignItems: 'center',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '700',
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '700',
  },
  itemPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  itemQty: {
    fontSize: 13,
  },
  itemRef: {
    fontSize: 12,
    marginTop: 4,
  },
  offerRefRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
  },
  itemRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 14,
  },
  itemVariant: {
    fontSize: 12,
    marginTop: 4,
  },
  paymentActionButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  paymentActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  paymentActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  statusBadgeSmall: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusTextSmall: {
    fontSize: 12,
    fontWeight: '700',
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '800',
  },
});
