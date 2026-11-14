import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { QuizLeaderboardScreen } from '@/components/quiz/QuizLeaderboardScreen';
import {
  QUIZ_STAGE_COLORS,
  QUIZ_STAGE_HEADER_OPTIONS,
} from '@/components/quiz/quiz-stage-colors';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';

export default function QuizLeaderboardsRoute() {
  return (
    <>
      <StatusBar barStyle="light-content" />
      <Stack.Screen
        options={{ ...QUIZ_STAGE_HEADER_OPTIONS, title: 'Past leaderboards' }}
      />
      <StorefrontScreenShell
        style={{ backgroundColor: QUIZ_STAGE_COLORS.background }}
      >
        <QuizLeaderboardScreen />
      </StorefrontScreenShell>
    </>
  );
}
