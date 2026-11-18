import { Image } from 'expo-image';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BRAND, palette, withAlpha } from '@/constants/Colors';
import mascotImage from '../assets/splash-scene/torso.png';

// Shown once, before Apple's App Tracking Transparency prompt. Apple's rules:
// it explains the prompt, never offers anything for allowing it, never looks
// like the system alert, and has a single button that always goes on to
// Apple's own question (no way to decline here and skip that question).
export const TRACKING_EXPLAINER_COPY = {
  title: 'A quick question from your phone',
  lead: 'Next, your device will ask if Ogabassey can use your activity from other apps and websites.',
  purpose:
    'This helps us show you offers that are relevant to you, and see which of our ads are working.',
  choice:
    'You can say no. Everything in the app still works, and you can change this anytime in Settings.',
  action: 'Continue',
} as const;

interface TrackingExplainerProps {
  visible: boolean;
  onContinue: () => void;
  onDismiss?: () => void;
}

function ignoreHardwareBackPress() {
  // Intentionally do not advance or skip ATT on Android hardware back.
}

export function TrackingExplainer({
  visible,
  onContinue,
  onDismiss,
}: TrackingExplainerProps) {
  // Keep the Modal mounted after becoming visible so iOS emits onDismiss when
  // the fade-out animation completes before Apple's prompt is presented.
  const [rendered, setRendered] = useState(visible);
  if (visible && !rendered) {
    setRendered(true);
  }
  if (!visible && !rendered) {
    return null;
  }

  return (
    <Modal
      animationType="fade"
      onDismiss={() => {
        setRendered(false);
        onDismiss?.();
      }}
      onRequestClose={ignoreHardwareBackPress}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      {visible ? <StatusBar barStyle="light-content" /> : null}
      <SafeAreaView style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >
          <Image
            accessibilityIgnoresInvertColors
            accessible={false}
            contentFit="contain"
            source={mascotImage}
            style={styles.mascot}
          />
          <Text accessibilityRole="header" style={styles.title}>
            {TRACKING_EXPLAINER_COPY.title}
          </Text>
          <Text style={styles.body}>{TRACKING_EXPLAINER_COPY.lead}</Text>
          <Text style={styles.body}>{TRACKING_EXPLAINER_COPY.purpose}</Text>
          <Text style={styles.muted}>{TRACKING_EXPLAINER_COPY.choice}</Text>
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          onPress={onContinue}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            {TRACKING_EXPLAINER_COPY.action}
          </Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const SPLASH_BACKGROUND = '#20000b';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SPLASH_BACKGROUND,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 16,
  },
  mascot: {
    width: 140,
    height: 126,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    color: palette.white,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  body: {
    color: withAlpha(palette.white, 0.88),
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  muted: {
    color: withAlpha(palette.white, 0.64),
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    backgroundColor: BRAND.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: palette.white,
    fontSize: 17,
    fontWeight: '700',
  },
});
