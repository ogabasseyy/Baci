import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  root: { alignItems: 'stretch', gap: 12, paddingTop: 8 },
  icon: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    marginBottom: 4,
    width: 60,
  },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingTop: 10,
  },
  rowText: { fontSize: 14 },
  bold: { fontWeight: '700' },
  struck: { textDecorationLine: 'line-through' },
  note: { fontSize: 13, textAlign: 'center' },
  working: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  actions: { gap: 4, marginTop: 8 },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
