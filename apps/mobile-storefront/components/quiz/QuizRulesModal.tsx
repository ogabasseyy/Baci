import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, Text, View } from 'react-native';
import { AdSlot } from '@/components/ads/AdSlot';
import { useTheme } from '@/hooks/useTheme';
import { createQuizLobbyStyles } from './QuizLobby.styles';

interface QuizRulesModalProps {
  eventTitle: string;
  onClose: () => void;
  onConfirm: () => void;
  requiresAcceptance: boolean;
  timePerQuestionSeconds: number;
  visible: boolean;
}

export function QuizRulesModal({
  eventTitle,
  onClose,
  onConfirm,
  requiresAcceptance,
  timePerQuestionSeconds,
  visible,
}: QuizRulesModalProps) {
  const { colors } = useTheme();
  const styles = createQuizLobbyStyles(colors);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!visible) setAccepted(false);
  }, [visible]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.modalBackdrop}>
        <View
          style={{
            alignItems: 'center',
            left: 0,
            position: 'absolute',
            right: 0,
            top: 16,
          }}
        >
          <AdSlot placement="FOOTER_ANCHOR" />
        </View>
        <View accessibilityViewIsModal style={styles.rulesSheet}>
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

          <View style={styles.rulesList}>
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
          </View>

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

          <View style={styles.rulesActionBox}>
            <Pressable
              accessibilityLabel={
                requiresAcceptance ? 'Accept and play quiz' : 'Close rules'
              }
              accessibilityRole="button"
              accessibilityState={{
                disabled: requiresAcceptance && !accepted,
              }}
              disabled={requiresAcceptance && !accepted}
              onPress={requiresAcceptance ? onConfirm : onClose}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                {requiresAcceptance ? 'Accept & play' : 'Got it'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
