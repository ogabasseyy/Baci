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
  title: { fontSize: 16, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 21 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 18,
    letterSpacing: 6,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  error: { fontSize: 12 },
  primary: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryText: { fontSize: 14, fontWeight: '700' },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  secondaryText: { fontSize: 13, fontWeight: '600' },
});
