import { describe, expect, it } from 'vitest';
import { validateStoreSettingsPhones } from './validate-store-settings-phones';

describe('validateStoreSettingsPhones', () => {
  it('rejects the truncated store phone that reached GIG bookings', () => {
    expect(validateStoreSettingsPhones({ phone: '+23415781' })).toBe(
      'Phone Number looks incomplete. Enter the full number with its country code, for example +234 801 234 5678.'
    );
  });

  it('rejects an incomplete support phone', () => {
    expect(validateStoreSettingsPhones({ support_phone: '+23444633' })).toBe(
      'Support Phone looks incomplete. Enter the full number with its country code, for example +234 801 234 5678.'
    );
  });

  it('rejects a bare store phone that booking would read as a short Nigerian number', () => {
    expect(validateStoreSettingsPhones({ phone: '15781234' })).toBe(
      'Phone Number looks incomplete. Enter the full number with its country code, for example +234 801 234 5678.'
    );
  });

  it('keeps the bare-number allowance for the support phone', () => {
    expect(
      validateStoreSettingsPhones({ support_phone: '15781234' })
    ).toBeNull();
    expect(validateStoreSettingsPhones({ phone: '08146978921' })).toBeNull();
  });

  it('accepts complete numbers, including the trunk 0 the picker keeps', () => {
    expect(
      validateStoreSettingsPhones({
        phone: '+2348146978921',
        support_phone: '+23408146978921',
      })
    ).toBeNull();
    expect(validateStoreSettingsPhones({ phone: '+447911123456' })).toBeNull();
  });

  it('allows clearing a phone and ignores fields the save does not change', () => {
    expect(validateStoreSettingsPhones({ phone: '' })).toBeNull();
    expect(validateStoreSettingsPhones({ business_name: 'Store' })).toBeNull();
    expect(validateStoreSettingsPhones({})).toBeNull();
  });
});
