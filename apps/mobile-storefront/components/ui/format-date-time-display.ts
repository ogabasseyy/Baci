export type DateTimeDisplayMode = 'date' | 'time';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function formatDateDisplay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '—';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '—';

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return '—';
  }

  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

function formatTimeDisplay(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return '—';

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '—';

  const displayHour = hours % 12 || 12;
  const period = hours < 12 ? 'AM' : 'PM';
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function formatDateTimeDisplay(
  value: string,
  mode: DateTimeDisplayMode
): string {
  return mode === 'date' ? formatDateDisplay(value) : formatTimeDisplay(value);
}
