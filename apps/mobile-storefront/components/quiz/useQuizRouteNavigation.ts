import { useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useRef } from 'react';
import { useQuizStore } from '@/stores/quiz-store';

export function useQuizRouteNavigation() {
  const router = useRouter();
  const status = useQuizStore((state) => state.status);
  const backHandlerRef = useRef<(() => void) | null>(null);
  const isInsideQuiz = [
    'starting',
    'question',
    'submitting',
    'result',
  ].includes(status);
  const onBack = () => {
    if (isInsideQuiz) backHandlerRef.current?.();
    else router.back();
  };
  // One removal policy covers Android Back and the iOS interactive gesture.
  usePreventRemove(isInsideQuiz, onBack);
  return { backHandlerRef, onBack };
}
