import { StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '@/constants/Colors';

export const quizUsernameGateStyles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  card: {
    alignSelf: 'center',
    borderRadius: RADIUS['3xl'],
    gap: SPACING.md,
    maxWidth: 480,
    padding: SPACING.lg,
    width: '100%',
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  headingGroup: {
    gap: SPACING.xs,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 29,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
