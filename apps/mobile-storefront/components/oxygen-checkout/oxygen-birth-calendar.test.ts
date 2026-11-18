import {
  oxygenBirthMonthDays,
  readOxygenBirthDate,
} from './oxygen-birth-calendar';

it('validates leap dates, strict dates and supported date bounds', () => {
  const today = new Date(2026, 10, 5);
  expect(readOxygenBirthDate('2000-02-29', today)).not.toBeNull();
  for (const value of [
    '1900-02-29',
    '1899-12-31',
    '2026-11-06',
    '2000-2-29',
    '2000-04-31',
  ]) {
    expect(readOxygenBirthDate(value, today)).toBeNull();
  }
});

it('keeps a stable Monday-first six-week grid', () => {
  const days = oxygenBirthMonthDays(2024, 1);
  expect(days).toHaveLength(42);
  expect(days.slice(0, 4)).toEqual([null, null, null, 1]);
  expect(days.filter(Boolean)).toHaveLength(29);
});
