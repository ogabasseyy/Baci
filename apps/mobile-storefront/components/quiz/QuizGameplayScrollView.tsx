import { type ReactNode, useEffect, useRef } from 'react';
import { ScrollView, type ScrollViewInstance } from 'react-native';
import type { createQuizStyles } from './QuizScreen.styles';

/** How long after a question change a layout pass may still re-apply the reset. */
export const QUIZ_SCROLL_RESET_WINDOW_MS = 500;

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
  // The new question may not have laid out when the key changes, so the
  // reset repeats once on the first content-size change after it. The flag
  // expires quickly: a later, unrelated size change (an ad loading) must
  // never pull a player back to the top mid-question.
  const resetPending = useRef(false);
  const scrollToTop = () =>
    scrollRef.current?.scrollTo({ animated: false, y: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: topKey is the trigger; the effect reads nothing from it.
  useEffect(() => {
    resetPending.current = true;
    scrollToTop();
    const expiry = setTimeout(() => {
      resetPending.current = false;
    }, QUIZ_SCROLL_RESET_WINDOW_MS);
    return () => clearTimeout(expiry);
  }, [topKey]);
  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.container}
      onContentSizeChange={() => {
        if (!resetPending.current) return;
        resetPending.current = false;
        scrollToTop();
      }}
      style={styles.screen}
      testID="quiz-gameplay-scroll"
    >
      {children}
    </ScrollView>
  );
}
