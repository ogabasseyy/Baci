// Server-off release-gate test: a pure formatter with no server or
// PiggyVest dependency, so it behaves the same with PiggyVest off.
import { describe, expect, it } from '@jest/globals';
import { formatFundingAccountName } from './format-funding-account-name';

describe('formatFundingAccountName', () => {
  it('puts the customer first, then the store’s short name', () => {
    expect(
      formatFundingAccountName(
        'Ogabassey Services Limited/Bassey John',
        'Ogabassey'
      )
    ).toBe('Bassey John / Ogabassey');
  });

  it('trims both sides around the slash', () => {
    expect(
      formatFundingAccountName('  Ogabassey Ltd /  Bassey John ', 'Ogabassey')
    ).toBe('Bassey John / Ogabassey');
  });

  it('shows a name with no slash unchanged', () => {
    expect(formatFundingAccountName('Bassey John', 'Ogabassey')).toBe(
      'Bassey John'
    );
  });

  it('shows the original when either side of the slash is empty', () => {
    expect(formatFundingAccountName('/Bassey John', 'Ogabassey')).toBe(
      '/Bassey John'
    );
    expect(
      formatFundingAccountName('Ogabassey Services Limited/ ', 'Ogabassey')
    ).toBe('Ogabassey Services Limited/ ');
  });

  it('splits on the first slash only, keeping a customer name with "/"', () => {
    expect(
      formatFundingAccountName(
        'Ogabassey Services Limited/Bassey John/Okon',
        'Ogabassey'
      )
    ).toBe('Bassey John/Okon / Ogabassey');
  });

  it('shows the original when the store name is unknown', () => {
    expect(
      formatFundingAccountName('Ogabassey Services Limited/Bassey John', '')
    ).toBe('Ogabassey Services Limited/Bassey John');
    expect(
      formatFundingAccountName('Ogabassey Services Limited/Bassey John', null)
    ).toBe('Ogabassey Services Limited/Bassey John');
  });
});
