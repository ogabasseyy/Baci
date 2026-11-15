import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack, useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { QuizRouteBackButton } from '@/components/quiz/QuizRouteBackButton';
import { QuizScreen } from '@/components/quiz/QuizScreen';
import { QuizStageStatusBar } from '@/components/quiz/QuizStageStatusBar';
import {
  QUIZ_STAGE_COLORS,
  QUIZ_STAGE_HEADER_OPTIONS,
} from '@/components/quiz/quiz-stage-colors';
import { useQuizRouteNavigation } from '@/components/quiz/useQuizRouteNavigation';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';

export default function QuizRoute() {
  const router = useRouter();
  const colors = QUIZ_STAGE_COLORS;
  const { backHandlerRef, onBack } = useQuizRouteNavigation();
  return (
    <>
      <QuizStageStatusBar />
      <Stack.Screen
        options={{
          ...QUIZ_STAGE_HEADER_OPTIONS,
          title: 'SuperQuiz',
          headerBackVisible: false,
          headerLeft: () => (
            <QuizRouteBackButton color={colors.text} onBack={onBack} />
          ),
          headerRight: () => (
            <Pressable
              accessibilityLabel="View previous quiz leaderboards"
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => router.push('/quiz/leaderboards')}
            >
              <Ionicons
                name="podium-outline"
                color={colors.warning}
                size={23}
              />
            </Pressable>
          ),
        }}
      />
      <StorefrontScreenShell style={{ backgroundColor: colors.background }}>
        <QuizScreen
          backHandlerRef={backHandlerRef}
          onSignIn={() => router.push('/auth/login')}
        />
      </StorefrontScreenShell>
    </>
  );
}
