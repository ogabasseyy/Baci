import { StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '@/constants/Colors';

export const usdtFundingStyles = StyleSheet.create({
  address: { fontSize: 12, lineHeight: 19 },
  addressBox: { borderRadius: RADIUS.lg, gap: SPACING.sm, padding: SPACING.md },
  balance: { fontSize: 25, fontWeight: '900' },
  button: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  chain: { borderRadius: RADIUS.md, borderWidth: 1, padding: SPACING.sm },
  chainRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chainText: { fontSize: 12, fontWeight: '700' },
  container: { flex: 1 },
  content: { gap: SPACING.md, padding: SPACING.md },
  error: { fontSize: 12, lineHeight: 19 },
  field: { gap: SPACING.xs },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  label: { fontSize: 12, fontWeight: '700' },
  subtitle: { fontSize: 13, lineHeight: 21 },
  title: { fontSize: 20, fontWeight: '900' },
});
