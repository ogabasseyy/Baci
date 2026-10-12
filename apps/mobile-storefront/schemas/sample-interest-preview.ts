export interface SampleInterestPreviewGoal {
  current_amount: number;
  status: string;
  title: string;
}

export interface SampleInterestPreview {
  goalTitle: string;
  savingsBeforeKobo: number;
  savingsAfterKobo: number;
  grossKobo: number;
  taxKobo: number;
  netKobo: number;
}

// Illustrative sample rate only: this preview is explicitly simulated and
// never represents a real PiggyVest payout. Vectors pinned by
// SampleInterestPreview.test (current_amount 1250 -> gross 814, tax 81).
const SAMPLE_GROSS_NUMERATOR = 814;
const SAMPLE_GROSS_DENOMINATOR = 125000;
const SAMPLE_WITHHOLDING_RATE = 0.1;

export function createSampleInterestPreview(
  goal: SampleInterestPreviewGoal | null
): SampleInterestPreview | null {
  if (goal?.status !== 'active') return null;
  if (!Number.isFinite(goal.current_amount) || goal.current_amount < 0)
    return null;
  const savingsBeforeKobo = Math.round(goal.current_amount * 100);
  const grossKobo = Math.round(
    (savingsBeforeKobo * SAMPLE_GROSS_NUMERATOR) / SAMPLE_GROSS_DENOMINATOR
  );
  const taxKobo = Math.round(grossKobo * SAMPLE_WITHHOLDING_RATE);
  const netKobo = grossKobo - taxKobo;
  return {
    goalTitle: goal.title,
    savingsBeforeKobo,
    savingsAfterKobo: savingsBeforeKobo + netKobo,
    grossKobo,
    taxKobo,
    netKobo,
  };
}
