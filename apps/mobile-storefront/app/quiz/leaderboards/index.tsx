import { Stack } from 'expo-router';
import { QuizLeaderboardScreen } from '@/components/quiz/QuizLeaderboardScreen';
import { QuizStageStatusBar } from '@/components/quiz/QuizStageStatusBar';
import {
  QUIZ_STAGE_COLORS,
  QUIZ_STAGE_HEADER_OPTIONS,
} from '@/components/quiz/quiz-stage-colors';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';

export default function QuizLeaderboardsRoute() {
  return (
    <>
      <QuizStageStatusBar />
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
