import { describe, expect, it } from 'vitest';
import { getPrimarySavingsWalletName } from './primary-savings-wallet-name';

const integrationId = '00000000-0000-4000-8000-000000000001';
const goalId = '00000000-0000-4000-8000-000000000002';

describe('primary savings wallet names', () => {
  it('produces a stable bounded provider name without exposing the identifiers', () => {
    const name = getPrimarySavingsWalletName(integrationId, goalId);

    expect(name).toBe('BaciSavingsbad7313391508e4129c338752b2cc809');
    expect(name).toMatch(/^BaciSavings[a-f0-9]{32}$/);
    expect(name).not.toContain(integrationId);
    expect(name).not.toContain(goalId);
    expect(getPrimarySavingsWalletName(integrationId, goalId)).toBe(name);
  });

  it('separates different integrations and savings goals', () => {
    expect(getPrimarySavingsWalletName(integrationId, goalId)).not.toBe(
      getPrimarySavingsWalletName(goalId, integrationId)
    );
    expect(getPrimarySavingsWalletName(integrationId, goalId)).not.toBe(
      getPrimarySavingsWalletName(integrationId, integrationId)
    );
  });

  it.each([
    '',
    'not-a-uuid',
    ' valid-looking ',
    '00000000-0000-4000-8000-00000000000z',
  ])('rejects an invalid integration or goal: %s', (invalid) => {
    expect(() => getPrimarySavingsWalletName(invalid, goalId)).toThrow();
    expect(() => getPrimarySavingsWalletName(integrationId, invalid)).toThrow();
  });
});
