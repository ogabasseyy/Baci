export interface QuizBadge {
  eventId: string;
  eventTitle: string;
  label: 'SuperQuiz badge';
  unlockedAt: number;
}

export type QuizBadgeMap = Record<string, Record<string, QuizBadge>>;
