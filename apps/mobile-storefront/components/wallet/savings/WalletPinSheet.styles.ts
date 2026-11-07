import { StyleSheet } from 'react-native';

export const walletPinSheetStyles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: 12,
    padding: 24,
  },
  title: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 20,
    letterSpacing: 6,
    minHeight: 56,
    paddingHorizontal: 18,
  },
  error: { fontSize: 13 },
  primary: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 56,
  },
  primaryText: { fontSize: 15, fontWeight: '700' },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  secondaryText: { fontSize: 14, fontWeight: '600' },
});
