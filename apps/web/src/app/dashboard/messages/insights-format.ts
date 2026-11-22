/** "45s", "12 min", "3 h 20 min", "2 d 4 h"; "—" when there is no data. */
export function formatInsightDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

/** A whole number, or "—" when the provider could not be read. */
export function formatInsightCount(count: number | null): string {
  return count === null ? '—' : String(count);
}
