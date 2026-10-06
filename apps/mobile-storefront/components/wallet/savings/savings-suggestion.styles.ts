import { StyleSheet } from 'react-native';

export const savingsSuggestionStyles = StyleSheet.create({
  results: { gap: 10, marginTop: 6 },
  heading: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
  },
  imageFrame: {
    width: 64,
    height: 76,
    padding: 6,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    overflow: 'hidden',
  },
  image: { width: 52, height: 64 },
  details: { flex: 1, gap: 4 },
  name: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  price: { fontSize: 16, lineHeight: 22, fontWeight: '800', marginTop: 3 },
});
