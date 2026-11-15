import { StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '@/constants/Colors';

/** The sticky footer: number field, one full-width pay button, "Pays from". */
export const footerStyles = StyleSheet.create({
  footer: {
    borderTopLeftRadius: RADIUS['3xl'],
    borderTopRightRadius: RADIUS['3xl'],
    borderTopWidth: 1,
    gap: 10,
    paddingHorizontal: SPACING.md,
    paddingTop: 14,
  },
  summary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  summaryName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14 },
  summaryPrice: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  hint: { fontSize: 12, marginTop: -4, paddingHorizontal: 4 },
  payButton: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 52,
  },
  payButtonDisabled: { opacity: 0.45 },
  payButtonText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  payFrom: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  payFromText: { fontSize: 12 },
  payFromAmount: { fontFamily: 'Inter_700Bold', fontSize: 12 },
});
