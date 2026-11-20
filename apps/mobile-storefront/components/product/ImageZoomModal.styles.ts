import { StyleSheet } from 'react-native';
import { RADIUS, SHADOWS, SPACING } from '@/constants/Colors';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    zIndex: 10,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  counter: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
  },
  counterText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  imageWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -28,
    zIndex: 5,
  },
  navButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.md,
  },
  thumbnailStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: SPACING.md,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  thumbnailContainer: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    opacity: 0.6,
  },
  thumbnailActive: {
    borderColor: '#FFF',
    opacity: 1,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  hint: {
    position: 'absolute',
    bottom: 140,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '500',
  },
});

export default styles;
