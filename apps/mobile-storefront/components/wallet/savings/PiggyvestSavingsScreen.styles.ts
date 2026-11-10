import { StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '@/constants/Colors';

export const piggyvestSavingsStyles = StyleSheet.create({
  content: { padding: SPACING.lg, gap: SPACING.md },
  heading: { fontSize: 20, fontWeight: '700' },
  section: {
    padding: SPACING.md,
    gap: SPACING.sm,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
  },
  label: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 24 },
  control: {
    minHeight: 44,
    justifyContent: 'center',
    padding: SPACING.md,
    borderWidth: 1,
    borderRadius: RADIUS.md,
  },
  disabled: { opacity: 0.5 },
});
