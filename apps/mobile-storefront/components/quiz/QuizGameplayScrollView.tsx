import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import type { createQuizStyles } from './QuizScreen.styles';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizGameplayScrollViewProps {
  children: ReactNode;
  styles: QuizStyles;
}

export function QuizGameplayScrollView({
  children,
  styles,
}: QuizGameplayScrollViewProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      style={styles.screen}
      testID="quiz-gameplay-scroll"
    >
      {children}
    </ScrollView>
  );
}
