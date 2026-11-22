import {
  filterOxygenBanks,
  otpRemainingSeconds,
  reusableHomeAddress,
  validateOxygenProof,
} from './oxygen-form-utils';

describe('Oxygen application boundaries', () => {
  it('sorts and searches bank names', () => {
    expect(
      filterOxygenBanks(
        [
          { code: '002', name: 'Zenith' },
          { code: '001', name: 'Access' },
        ],
        ''
      )[0].name
    ).toBe('Access');
    expect(
      filterOxygenBanks([{ code: '002', name: 'Zenith' }], 'ZEN')
    ).toHaveLength(1);
  });
  it('finds banks when the search omits or adds spaces', () => {
    const banks = [{ code: '058', name: 'GT Bank' }];
    expect(filterOxygenBanks(banks, 'gtb')).toEqual(banks);
    expect(filterOxygenBanks(banks, 'g t b')).toEqual(banks);
    expect(filterOxygenBanks(banks, ' gt bank ')).toEqual(banks);
    expect(filterOxygenBanks(banks, 'gtz')).toEqual([]);
  });
  it('never proposes a pickup office as home', () => {
    expect(
      reusableHomeAddress({ kind: 'pickup', fields: { home_street: 'Office' } })
    ).toBeNull();
    expect(
      reusableHomeAddress({
        kind: 'delivery',
        fields: {
          home_street: 'Road',
          home_city: 'Ikeja',
          home_state: 'Lagos',
          home_lga: 'Ikeja',
          home_house_number: '2',
        },
      })
    ).not.toBeNull();
  });
  it('accepts only bounded PDF JPEG PNG proof', () => {
    expect(
      validateOxygenProof({ size: 1572864, mimeType: 'application/pdf' })
    ).toBeNull();
    expect(
      validateOxygenProof({ size: 1572865, mimeType: 'application/pdf' })
    ).toMatch(/1.5/);
    expect(validateOxygenProof({ size: 4, mimeType: 'image/heic' })).toMatch(
      /PDF/
    );
    expect(validateOxygenProof({ mimeType: 'image/png' })).toBeTruthy();
  });
  it('anchors phone expiry to five minutes and approval to the server window', () => {
    const sentAt = '2026-11-04T10:00:00Z';
    expect(otpRemainingSeconds({ sentAt }, Date.parse(sentAt) + 299000)).toBe(
      1
    );
    expect(otpRemainingSeconds({ sentAt }, Date.parse(sentAt) + 300000)).toBe(
      0
    );
    expect(
      otpRemainingSeconds(
        { sentAt, expiresAt: '2026-11-04T10:01:00Z' },
        Date.parse(sentAt) + 61000
      )
    ).toBe(0);
    expect(otpRemainingSeconds({}, Date.now())).toBe(0);
  });
});
