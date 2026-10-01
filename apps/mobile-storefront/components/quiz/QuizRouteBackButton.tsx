import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable } from 'react-native';
import { useQuizStore } from '@/stores/quiz-store';

export function QuizRouteBackButton({
  color,
  onBack,
}: {
  color: string;
  onBack: () => void;
}) {
  const status = useQuizStore((state) => state.status);

  return (
    <Pressable
      accessibilityLabel={status === 'result' ? 'Back to SuperQuiz' : 'Go back'}
      accessibilityRole="button"
      hitSlop={12}
      onPress={onBack}
    >
      <Ionicons name="chevron-back" color={color} size={26} />
    </Pressable>
  );
}
