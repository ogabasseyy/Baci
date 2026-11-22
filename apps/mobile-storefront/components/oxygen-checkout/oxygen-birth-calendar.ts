export const OXYGEN_BIRTH_MONTHS = [
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
];

export function readOxygenBirthDate(
  value: string | undefined,
  today: Date
): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    year < 1900 ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date > today
  )
    return null;
  return date;
}

export function oxygenBirthDateValue(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Fixed six-week grid, Monday first, so month changes do not shift the sheet. */
export function oxygenBirthMonthDays(
  year: number,
  month: number
): (number | null)[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) =>
    index >= offset && index < offset + count ? index - offset + 1 : null
  );
}

/** Display day first while keeping the persisted value in ISO format. */
export function oxygenBirthDateInput(value?: string): string {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function formatOxygenBirthDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
    .filter(Boolean)
    .join('/');
}

export function parseOxygenBirthDateInput(
  value: string,
  today: Date
): string | undefined {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return undefined;
  const [day, month, year] = value.split('/');
  const iso = `${year}-${month}-${day}`;
  return readOxygenBirthDate(iso, today) ? iso : undefined;
}
