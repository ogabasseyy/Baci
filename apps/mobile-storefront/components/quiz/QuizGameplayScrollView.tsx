import { type ReactNode, useEffect, useRef } from 'react';
import { ScrollView, type ScrollViewInstance } from 'react-native';
import type { createQuizStyles } from './QuizScreen.styles';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizGameplayScrollViewProps {
  children: ReactNode;
  /** Changes with each question so a new question always starts at the top. */
  topKey?: string | null;
  styles: QuizStyles;
}

export function QuizGameplayScrollView({
  children,
  topKey = null,
  styles,
}: QuizGameplayScrollViewProps) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: topKey is the trigger; the effect reads nothing from it.
  useEffect(() => {
    scrollRef.current?.scrollTo({ animated: false, y: 0 });
  }, [topKey]);
  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.container}
      style={styles.screen}
      testID="quiz-gameplay-scroll"
    >
      {children}
    </ScrollView>
  );
}
