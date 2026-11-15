import { StyleSheet } from 'react-native';
import { palette, RADIUS, SPACING } from '@/constants/Colors';
import { IMEI_MONOSPACE_FONT } from './imei-check-theme';

/** The report page: verdict banner, device card, one list of findings. */
export const reportStyles = StyleSheet.create({
  content: { gap: SPACING.md, padding: SPACING.md },
  verdict: {
    borderRadius: RADIUS['3xl'],
    borderWidth: 1,
    gap: 10,
    padding: SPACING.md,
  },
  verdictTop: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  verdictHeadline: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 18 },
  verdictBody: { fontSize: 13, lineHeight: 19 },
  score: {
    alignItems: 'center',
    borderRadius: RADIUS['2xl'],
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scoreValue: { fontSize: 20, fontWeight: '800' },
  scoreLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  device: {
    alignItems: 'center',
    borderRadius: RADIUS['2xl'],
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.md,
  },
  deviceImageBox: {
    alignItems: 'center',
    // Always white: catalogue photos are cut out on white.
    backgroundColor: palette.white,
    borderRadius: RADIUS.xl,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  deviceImage: { height: 56, width: 56 },
  deviceInfo: { flex: 1, gap: 2 },
  tierName: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  deviceName: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  deviceMeta: { fontSize: 12 },
  imei: { fontFamily: IMEI_MONOSPACE_FONT, fontSize: 12 },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    marginBottom: -SPACING.xs,
    paddingHorizontal: 2,
  },
  list: { borderRadius: RADIUS['2xl'], borderWidth: 1, overflow: 'hidden' },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
  rowIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 12 },
  rowValue: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  again: {
    alignItems: 'center',
    borderRadius: RADIUS['2xl'],
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 52,
  },
  againText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
});
