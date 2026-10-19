import { ActivityIndicator, View } from 'react-native';
import { QuizErrorPanel } from './QuizErrorPanel';
import type { createQuizStyles } from './QuizScreen.styles';
import type { QuizScreenStatus } from './QuizScreen.utils';

interface Props {
  status: QuizScreenStatus;
  error: string | null;
  isDobGateVisible: boolean;
  onRetry: () => void;
  primaryColor: string;
  styles: ReturnType<typeof createQuizStyles>;
}

export function QuizScreenFeedback({
  status,
  error,
  isDobGateVisible,
  onRetry,
  primaryColor,
  styles,
}: Props) {
  return (
    <>
      {status === 'loading' ? (
        <View style={styles.container}>
          <ActivityIndicator accessibilityLabel="Loading quiz events" />
        </View>
      ) : null}
      {error && !isDobGateVisible ? (
        <QuizErrorPanel
          description={error}
          onRetry={onRetry}
          primaryColor={primaryColor}
          showRetry={status === 'ready' || status === 'error'}
          styles={styles}
          title={
            status === 'question' || status === 'submitting'
              ? 'We couldn’t continue the quiz'
              : undefined
          }
        />
      ) : null}
    </>
  );
}
