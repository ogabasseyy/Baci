import Ionicons from '@react-native-vector-icons/ionicons';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import { GoogleLogo } from '../../../icons/GoogleLogo';
import type { CheckoutIdentityTheme } from '../colors';
import { styles } from '../styles';

interface SocialCheckoutButtonsProps {
  isLoading: boolean;
  onAppleSignIn: () => void;
  onGoogleSignIn: () => void;
  theme: CheckoutIdentityTheme;
}

export function SocialCheckoutButtons({
  isLoading,
  onAppleSignIn,
  onGoogleSignIn,
  theme,
}: SocialCheckoutButtonsProps) {
  const sharedButtonStyle = [
    styles.socialCheckoutButton,
    {
      backgroundColor: theme.input,
      borderColor: theme.border,
    },
    isLoading && styles.socialButtonDisabled,
  ];

  return (
    <View style={styles.socialCheckoutSection}>
      <View style={styles.socialCheckoutRow}>
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={sharedButtonStyle}
            onPress={onAppleSignIn}
            disabled={isLoading}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
            accessibilityHint="Sign in or create an account using your Apple ID"
            accessibilityState={{ disabled: isLoading }}
          >
            <Ionicons
              name="logo-apple"
              size={20}
              color={theme.mutedText}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text
              style={[styles.socialCheckoutButtonText, { color: theme.text }]}
            >
              Apple
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={sharedButtonStyle}
          onPress={onGoogleSignIn}
          disabled={isLoading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Sign in with Google"
          accessibilityHint="Sign in or create an account using your Google account"
          accessibilityState={{ disabled: isLoading }}
        >
          <GoogleLogo size={20} />
          <Text
            style={[styles.socialCheckoutButtonText, { color: theme.text }]}
          >
            Sign in with Google
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
