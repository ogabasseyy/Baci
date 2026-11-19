import { StyleSheet, Text, View } from 'react-native';
import { QUIZ_STAGE_COLORS } from './quiz-stage-colors';

/**
 * Covers the waiting room for a moment before the pre-quiz full-screen ad
 * appears. It swallows every touch, so the ad can never land under a finger
 * that was heading for "View rules" or "Leave waiting room".
 */
export function QuizAdBreakNotice() {
  return (
    <View
      accessible
      accessibilityLabel="Short ad break. Your place in the quiz is saved."
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      accessibilityViewIsModal
      onStartShouldSetResponder={() => true}
      style={styles.cover}
      testID="quiz-ad-break-notice"
    >
      <Text style={styles.title}>Short ad break</Text>
      <Text style={styles.body}>Your place in the quiz is saved.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    backgroundColor: QUIZ_STAGE_COLORS.background,
    bottom: 0,
    gap: 8,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  title: {
    color: QUIZ_STAGE_COLORS.text,
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  body: {
    color: QUIZ_STAGE_COLORS.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
});
