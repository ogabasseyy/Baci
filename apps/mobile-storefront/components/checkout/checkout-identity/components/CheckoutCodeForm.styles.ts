import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  form: { gap: 12 },
  field: { gap: 6 },
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  helpText: { fontFamily: 'Inter_400Regular' },
  input: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  submit: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  changeEmail: {
    paddingVertical: 12,
    textDecorationLine: 'underline',
    fontFamily: 'Inter_400Regular',
  },
});
