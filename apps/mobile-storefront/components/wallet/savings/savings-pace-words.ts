import type { SavingsFrequency } from './start-savings.helpers';

const PER: Record<SavingsFrequency, string> = {
  daily: 'a day',
  weekly: 'a week',
  monthly: 'a month',
};

/** "daily" -> "a day", for "₦2,000 a day". */
export function savingsPaceWords(frequency: SavingsFrequency): string {
  return PER[frequency];
}
