function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!minutes) return `${remainder}s`;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function QuizPlanSummary({
  closesAt,
  questionCount,
  timePerQuestionSeconds,
}: {
  closesAt: string;
  questionCount: number;
  timePerQuestionSeconds: number;
}) {
  return (
    <aside
      aria-label="Quiz plan summary"
      className="rounded-lg border bg-muted/35 p-4 text-sm"
    >
      <p className="font-semibold">Quiz summary</p>
      <p className="mt-1 text-muted-foreground">
        {questionCount} questions, {timePerQuestionSeconds} seconds each.
        Expected play: {durationLabel(questionCount * timePerQuestionSeconds)}.
      </p>
      <p className="mt-1 text-muted-foreground">
        Universal close: {closesAt ? `${closesAt}.` : 'Set the launch window.'}{' '}
        Late players get only the time remaining.
      </p>
    </aside>
  );
}
