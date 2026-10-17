import { StyleSheet } from 'react-native';
import { SPACING } from '@/constants/Colors';

/** Height reserved for the absolutely-positioned payment footer */
export const DATA_FOOTER_HEIGHT = 120;
export const DATA_FOOTER_ERROR_BUFFER = 36;

export const dataFormStyles = StyleSheet.create({
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: SPACING.sm },
  input: {
    height: 50,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  inputGroup: { marginBottom: SPACING.sm },
  label: { fontSize: 14, marginBottom: 8 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    borderTopWidth: 1,
  },
  payButton: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
