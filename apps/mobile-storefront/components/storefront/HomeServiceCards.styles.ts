import { StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '@/constants/Colors';

export const CARD_GAP = SPACING.sm;

export const styles = StyleSheet.create({
  outerContainer: {
    width: '100%',
  },
  scrollContainer: {
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    gap: CARD_GAP,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.md,
    paddingTop: 8,
    paddingBottom: 8,
    marginBottom: 4,
    gap: CARD_GAP,
  },
  pointsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 5,
    paddingBottom: 12,
  },
  pointsTitle: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    flexShrink: 1,
  },
  featureTile: {
    minHeight: 73,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 8,
    gap: 4,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
  },
  aboveUtility: {
    marginTop: 8,
    marginBottom: -8,
    transform: [{ translateY: -14 }],
  },
  belowUtility: {
    marginTop: 28,
    marginBottom: -2,
  },
  card: {
    flexDirection: 'row',
    gap: 6,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  cardPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    zIndex: 1,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  icon: {
    marginRight: 6,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontWeight: 'bold',
    fontSize: 13,
    lineHeight: 15,
    flexShrink: 1,
  },
  compactTitle: {
    fontSize: 11,
  },
});
