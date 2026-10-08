import { StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '@/constants/Colors';

export const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'space-between',
    padding: SPACING.md,
  },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  preferenceRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'space-between',
    padding: SPACING.md,
  },
  preferenceCopy: { flex: 1 },
  preferenceLabel: { fontSize: 15, fontWeight: '600' },
  preferenceDescription: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  quietHours: { borderTopWidth: StyleSheet.hairlineWidth, padding: SPACING.md },
  quietHoursTitle: { fontSize: 15, fontWeight: '600' },
  timeFields: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  timeField: { flex: 1 },
  timeZoneLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: SPACING.sm,
  },
  timeInput: {
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 10,
  },
  timeZoneInput: {
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 10,
  },
});
