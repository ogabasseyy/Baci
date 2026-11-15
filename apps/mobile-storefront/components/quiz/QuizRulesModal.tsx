import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdSlot } from '@/components/ads/AdSlot';
import { createQuizLobbyStyles } from './QuizLobby.styles';
import { QUIZ_STAGE_COLORS } from './quiz-stage-colors';

// Clear space kept between the banner and the sheet (and its close
// button), per AdMob's accidental-click guidance.
export const QUIZ_RULES_BANNER_CLEAR_SPACE = 24;
// Least room the sheet needs to stay usable (header, a rule or two, the
// action button). With less than this under the banner, the banner is
// left out instead of squeezing the sheet or painting over the ad.
export const QUIZ_RULES_SHEET_MIN_HEIGHT = 320;

interface QuizRulesModalProps {
  eventTitle: string;
  onClose: () => void;
  onConfirm: () => void;
  onDismissed?: () => void;
  requiresAcceptance: boolean;
  timePerQuestionSeconds: number;
  visible: boolean;
}

export function QuizRulesModal({
  eventTitle,
  onClose,
  onConfirm,
  onDismissed,
  requiresAcceptance,
  timePerQuestionSeconds,
  visible,
}: QuizRulesModalProps) {
  const colors = QUIZ_STAGE_COLORS;
  const styles = createQuizLobbyStyles(colors);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Bottom edge of the banner, measured: the slot's height depends on the
  // ad it loads, so a fixed share of the screen could let a tall sheet's
  // close button sit right under the ad.
  const [bannerBottom, setBannerBottom] = useState<number | null>(null);
  const roomUnderBanner =
    bannerBottom === null
      ? null
      : windowHeight - bannerBottom - QUIZ_RULES_BANNER_CLEAR_SPACE;
  const bannerFits =
    roomUnderBanner === null || roomUnderBanner >= QUIZ_RULES_SHEET_MIN_HEIGHT;
  const sheetMaxHeight =
    roomUnderBanner === null || !bannerFits ? '75%' : roomUnderBanner;
  const [accepted, setAccepted] = useState(false);
  const isPlayLocked = requiresAcceptance && !accepted;

  useEffect(() => {
    if (visible) return;
    setAccepted(false);
    // The next opening measures its own banner: the ad, and so its height,
    // can differ.
    setBannerBottom(null);
  }, [visible]);

  return (
    <Modal
      animationType="slide"
      onDismiss={onDismissed}
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.modalBackdrop}>
        <View
          testID="quiz-rules-modal-banner"
          onLayout={(event) => {
            const { height, y } = event.nativeEvent.layout;
            setBannerBottom(y + height);
          }}
          style={{
            alignItems: 'center',
            left: 0,
            position: 'absolute',
            right: 0,
            // Below the status bar / display cutout: the overFullScreen
            // modal draws under system chrome, so a fixed offset would hide
            // the creative and its tap target on tall-inset devices.
            top: insets.top + 16,
          }}
        >
          {bannerFits ? <AdSlot placement="FOOTER_ANCHOR" /> : null}
        </View>
        <View
          accessibilityViewIsModal
          style={[styles.rulesSheet, { maxHeight: sheetMaxHeight }]}
        >
          <View style={styles.rulesHeader}>
            <View>
              <Text accessibilityRole="header" style={styles.rulesTitle}>
                How to play
              </Text>
              <Text style={styles.rulesEvent}>{eventTitle}</Text>
            </View>
            <Pressable
              accessibilityLabel="Close quiz rules"
              accessibilityRole="button"
              hitSlop={12}
              onPress={onClose}
            >
              <Ionicons name="close" color={colors.text} size={26} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.rulesList}
            testID="quiz-rules-list"
          >
            <Text style={styles.ruleText}>
              1. You have {timePerQuestionSeconds} seconds for each question.
            </Text>
            <Text style={styles.ruleText}>
              2. An answer locks as soon as you tap it. You cannot go back.
            </Text>
            <Text style={styles.ruleText}>
              3. The quiz closes for everyone at the displayed end time, even if
              you join late.
            </Text>
            <Text style={styles.ruleText}>
              4. Fast, correct answers rank highest. One eligible attempt per
              player and device.
            </Text>
            <Text style={styles.ruleText}>
              5. Entry is free. No purchase, payment, loyalty points, or paid
              membership is required.
            </Text>
            <Text style={styles.ruleText}>
              6. Winners are ranked by score, shortest completion time, then
              earliest valid submission. There is no random draw or random
              tie-breaker.
            </Text>
          </ScrollView>

          {requiresAcceptance ? (
            <Pressable
              accessibilityLabel="Accept quiz rules and terms"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted }}
              onPress={() => setAccepted((value) => !value)}
              style={styles.termsRow}
            >
              <Ionicons
                color={accepted ? colors.primary : colors.textSecondary}
                name={accepted ? 'checkbox' : 'square-outline'}
                size={24}
              />
              <Text style={styles.termsText}>
                I have read the rules and agree to the{' '}
                <Text
                  accessibilityLabel="Open quiz terms and conditions"
                  accessibilityRole="link"
                  onPress={() => {
                    void Linking.openURL('https://usebaci.com/terms');
                  }}
                  style={styles.termsLink}
                >
                  terms and conditions
                </Text>
                .
              </Text>
            </Pressable>
          ) : null}

          <View
            style={
              isPlayLocked ? styles.disabledButtonBox : styles.rulesActionBox
            }
          >
            <Pressable
              accessibilityLabel={
                requiresAcceptance ? 'Accept and play quiz' : 'Close rules'
              }
              accessibilityRole="button"
              accessibilityState={{ disabled: isPlayLocked }}
              disabled={isPlayLocked}
              onPress={requiresAcceptance ? onConfirm : onClose}
              style={styles.primaryButton}
            >
              <Text
                style={
                  isPlayLocked
                    ? styles.disabledButtonText
                    : styles.primaryButtonText
                }
              >
                {requiresAcceptance ? 'Accept & play' : 'Got it'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
