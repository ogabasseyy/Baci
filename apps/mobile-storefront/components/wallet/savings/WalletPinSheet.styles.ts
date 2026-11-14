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
    gap: 14,
    paddingBottom: 32,
    paddingHorizontal: 24,
    paddingTop: 22,
  },
  // Inside the savings sheet: that sheet already has the corners and padding.
  embedded: { borderRadius: 0, paddingTop: 8 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  icon: {
    alignItems: 'center',
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '700' },
  close: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  body: { fontSize: 13, lineHeight: 19, marginTop: -8, paddingLeft: 40 },
  context: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  contextText: { flex: 1, fontSize: 13, fontWeight: '500' },
  error: { fontSize: 12, textAlign: 'center' },
  primary: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryText: { fontSize: 15, fontWeight: '700' },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  footerText: { fontSize: 12 },
  notice: { fontSize: 12, textAlign: 'center' },
  secondary: { alignItems: 'center', paddingVertical: 4 },
  secondaryText: { fontSize: 13, fontWeight: '600' },
});
