import { StyleSheet } from 'react-native';
import { RADIUS, SHADOWS, SPACING } from '@/constants/Colors';
import cartItemStyles from './cart-item.styles';
import checkoutStyles from './checkout.styles';
import warningStyles from './warning.styles';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateBackButton: {
    position: 'absolute',
    left: 16,
    zIndex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  headerCount: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
  },
  clearText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
    gap: SPACING.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyIconBg: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  emptyTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: SPACING.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.xl,
  },
  shopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: RADIUS.xl,
    ...SHADOWS.lg,
  },
  shopButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  ...cartItemStyles,
  ...checkoutStyles,
  ...warningStyles,
});

export default styles;
