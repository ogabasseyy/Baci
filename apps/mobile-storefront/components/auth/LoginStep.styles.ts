import { StyleSheet } from 'react-native';

export const loginStepStyles = StyleSheet.create({
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 32,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 16,
    // Explicit, not omitted: after a code sign-in the email placeholder came
    // back letter-spaced, most likely a recycled native TextInput keeping the
    // code field's spacing when the new props leave it unset.
    letterSpacing: 0,
  },
  otpInput: {
    letterSpacing: 8,
    fontSize: 20,
    fontWeight: '600',
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    paddingHorizontal: 16,
    fontSize: 13,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 24,
  },
  socialButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  socialContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  methodToggle: {
    alignItems: 'center',
    marginBottom: 32,
    paddingVertical: 8,
  },
  methodToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  termsText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  link: {
    fontWeight: '500',
  },
  resendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  resendText: {
    fontSize: 14,
  },
  resendLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  passwordToggle: {
    padding: 4,
  },
  pressablePressed: {
    opacity: 0.7,
  },
  errorText: {
    fontSize: 13,
    marginTop: 6,
    marginLeft: 4,
  },
});
