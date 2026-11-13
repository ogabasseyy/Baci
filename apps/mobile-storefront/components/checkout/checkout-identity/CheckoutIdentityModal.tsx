import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
import { useColorScheme } from '@/components/useColorScheme';
import { getCheckoutIdentityTheme } from './colors';
import {
  Divider,
  ErrorAlert,
  SecurityFooter,
  SocialCheckoutButtons,
} from './components';
import { CheckoutCodeForm } from './components/CheckoutCodeForm';
import { CheckoutSheetPresentation } from './components/CheckoutSheetPresentation';
import {
  useBottomSheetAnimation,
  useHapticFeedback,
  useSignInForm,
} from './hooks';
import { styles } from './styles';

interface CheckoutIdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerified?: () => void;
  onGuestCheckout?: () => void;
}

export function CheckoutIdentityModal({
  isOpen,
  onClose,
  onVerified,
  onGuestCheckout,
}: CheckoutIdentityModalProps) {
  return isOpen ? (
    <CheckoutIdentitySheet
      onClose={onClose}
      onGuestCheckout={onGuestCheckout}
      onVerified={onVerified}
    />
  ) : null;
}

function CheckoutIdentitySheet({
  onClose,
  onGuestCheckout,
  onVerified,
}: Pick<
  CheckoutIdentityModalProps,
  'onClose' | 'onGuestCheckout' | 'onVerified'
>) {
  const otpBusy = useRef(false);
  const otpVerificationBusy = useRef(false);
  const [isOtpBusy, setIsOtpBusy] = useState(false);
  const [isOtpVerificationBusy, setIsOtpVerificationBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const colorScheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const theme = getCheckoutIdentityTheme(colorScheme);
  const { triggerHaptic } = useHapticFeedback();

  // Bottom sheet animations with reduced motion support
  const { animatedBackdropStyle, animatedSheetStyle } = useBottomSheetAnimation(
    {
      isOpen: true,
    }
  );

  const handleSignInSuccess = () => {
    onClose();
    if (onVerified) onVerified();
    else router.push('/checkout');
  };

  const {
    error: socialAuthError,
    handleAppleSignIn,
    handleGoogleSignIn,
    isLoading: isSocialAuthLoading,
  } = useSignInForm({ onSuccess: handleSignInSuccess });

  const handleClose = () => {
    if (otpVerificationBusy.current || isSocialAuthLoading) return;
    triggerHaptic('light');
    Keyboard.dismiss();
    onClose();
  };

  const handleGuestCheckout = () => {
    if (otpBusy.current || isSocialAuthLoading) return;
    triggerHaptic('light');
    Keyboard.dismiss();
    onClose();
    if (onGuestCheckout) onGuestCheckout();
    else router.push('/checkout');
  };

  const handleVerified = () => {
    Keyboard.dismiss();
    onClose();
    if (onVerified) onVerified();
    else router.push('/checkout');
  };

  const handleOtpBusyChange = (busy: boolean) => {
    otpBusy.current = busy;
    setIsOtpBusy(busy);
  };

  const handleOtpVerificationBusyChange = (busy: boolean) => {
    otpVerificationBusy.current = busy;
    setIsOtpVerificationBusy(busy);
  };

  return (
    <CheckoutSheetPresentation
      busy={isOtpVerificationBusy || isSocialAuthLoading}
      onClose={handleClose}
    >
      <AppKeyboardContainer style={styles.container}>
        {/* Backdrop */}
        <Animated.View
          style={[
            styles.backdrop,
            { backgroundColor: theme.backdrop },
            animatedBackdropStyle,
          ]}
        >
          <Pressable
            style={styles.backdropPressable}
            onPress={handleClose}
            disabled={isOtpVerificationBusy || isSocialAuthLoading}
            accessibilityState={{
              disabled: isOtpVerificationBusy || isSocialAuthLoading,
            }}
            accessibilityRole="button"
            accessibilityLabel="Close modal"
            accessibilityHint="Double tap to close the checkout options"
          />
        </Animated.View>

        {/* Bottom Sheet */}
        <Animated.View
          style={[
            styles.sheet,
            animatedSheetStyle,
            {
              backgroundColor: theme.sheet,
              borderColor: theme.border,
            },
          ]}
          accessibilityRole="none"
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.identityHeader}>
              <View style={styles.identityHeading}>
                <Text
                  style={[styles.identityEyebrow, { color: theme.primary }]}
                >
                  Checkout
                </Text>
                <Text
                  accessibilityRole="header"
                  style={[styles.identityTitle, { color: theme.text }]}
                >
                  Let’s get you started
                </Text>
                <Text
                  style={[
                    styles.identityDescription,
                    { color: theme.mutedText },
                  ]}
                >
                  Sign in or create an account for a faster checkout.
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                disabled={isOtpVerificationBusy || isSocialAuthLoading}
                accessibilityState={{
                  disabled: isOtpVerificationBusy || isSocialAuthLoading,
                }}
                style={styles.identityClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color={theme.mutedText} />
              </Pressable>
            </View>
            <ErrorAlert error={socialAuthError} theme={theme} />
            <CheckoutCodeForm
              onVerified={handleVerified}
              onBusyChange={handleOtpBusyChange}
              onVerificationBusyChange={handleOtpVerificationBusyChange}
              socialBusy={isSocialAuthLoading}
              theme={theme}
              renderSocial={(emailBusy) => (
                <>
                  <Divider theme={theme} />
                  <SocialCheckoutButtons
                    isLoading={emailBusy || isSocialAuthLoading}
                    onAppleSignIn={handleAppleSignIn}
                    onGoogleSignIn={handleGoogleSignIn}
                    theme={theme}
                  />
                </>
              )}
            />
            <Pressable
              onPress={handleGuestCheckout}
              disabled={isOtpBusy || isSocialAuthLoading}
              accessibilityState={{
                disabled: isOtpBusy || isSocialAuthLoading,
              }}
              style={styles.guestLink}
              accessibilityRole="button"
            >
              <Text style={[styles.guestLinkText, { color: theme.mutedText }]}>
                Continue as Guest
              </Text>
              <Ionicons
                name="arrow-forward"
                size={16}
                color={theme.mutedText}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </Pressable>
          </ScrollView>

          {/* Footer */}
          <SecurityFooter bottomInset={insets.bottom} theme={theme} />
        </Animated.View>
      </AppKeyboardContainer>
    </CheckoutSheetPresentation>
  );
}
