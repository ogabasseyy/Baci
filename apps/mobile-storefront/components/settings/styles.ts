import { StyleSheet } from 'react-native';
import { RADIUS, SHADOWS, SPACING } from '@/constants/Colors';

const SETTINGS_ICON_SIZE = 42;
const SETTINGS_ICON_RADIUS = 14;
const SETTINGS_ROW_SUBTITLE_MARGIN_TOP = 2;
const SETTINGS_ROW_CONTROL_WIDTH = 64;

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  card: {
    borderRadius: RADIUS['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  segmentedControl: {
    flexDirection: 'row',
    padding: SPACING.xs,
    gap: SPACING.xs,
  },
  segmentOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm + SPACING.xs,
    borderRadius: RADIUS.xl,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 72,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: SPACING.sm,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: SETTINGS_ROW_CONTROL_WIDTH,
    flexShrink: 0,
    marginLeft: SPACING.sm,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 1,
  },
  rowSub: {
    fontSize: 12,
    flexShrink: 1,
    marginTop: SETTINGS_ROW_SUBTITLE_MARGIN_TOP,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  iconCircle: {
    flexShrink: 0,
    width: SETTINGS_ICON_SIZE,
    height: SETTINGS_ICON_SIZE,
    borderRadius: SETTINGS_ICON_RADIUS,
    marginRight: SPACING.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    textAlign: 'center',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
    opacity: 0.4,
    paddingBottom: SPACING.sm,
  },
  notificationError: {
    fontSize: 12,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
});
