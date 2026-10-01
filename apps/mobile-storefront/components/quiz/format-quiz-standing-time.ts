export function formatQuizStandingTime(
  totalTimeSeconds: number | null
): string | null {
  if (totalTimeSeconds === null || !Number.isFinite(totalTimeSeconds)) {
    return null;
  }

  const safeSeconds = Math.max(0, totalTimeSeconds);
  const roundedHundredths = Math.round(safeSeconds * 100);
  if (roundedHundredths < 60 * 100)
    return `${(roundedHundredths / 100).toFixed(2)}s`;

  const minutes = Math.floor(roundedHundredths / (60 * 100));
  const secondsHundredths = roundedHundredths % (60 * 100);
  return `${minutes}:${(secondsHundredths / 100).toFixed(2).padStart(5, '0')}`;
}
