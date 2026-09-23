import { describe, expect, it } from 'vitest';
import { isMergedRepairPickupPhoneValid } from './is-merged-repair-pickup-phone-valid';

describe('isMergedRepairPickupPhoneValid', () => {
  it('allows any phone only when courier pickup is explicitly disabled', () => {
    expect(
      isMergedRepairPickupPhoneValid({
        pickup_enabled: false,
        contact_phone: '',
      })
    ).toBe(true);
    expect(
      isMergedRepairPickupPhoneValid({
        pickup_enabled: false,
        contact_phone: 'not-a-phone',
      })
    ).toBe(true);
  });

  it('requires a valid phone when pickup_enabled is omitted (DB default enabled)', () => {
    expect(
      isMergedRepairPickupPhoneValid({
        contact_phone: '09070007000',
      })
    ).toBe(true);
    expect(
      isMergedRepairPickupPhoneValid({
        contact_phone: 'not-a-phone',
      })
    ).toBe(false);
    expect(
      isMergedRepairPickupPhoneValid({
        contact_phone: '12345',
      })
    ).toBe(false);
  });

  it('requires a valid phone when courier pickup stays enabled', () => {
    expect(
      isMergedRepairPickupPhoneValid({
        pickup_enabled: true,
        contact_phone: '09070007000',
      })
    ).toBe(true);
    expect(
      isMergedRepairPickupPhoneValid({
        pickup_enabled: true,
        contact_phone: '',
      })
    ).toBe(false);
    expect(
      isMergedRepairPickupPhoneValid({
        pickup_enabled: true,
        contact_phone: 'not-a-phone',
      })
    ).toBe(false);
    expect(
      isMergedRepairPickupPhoneValid({
        pickup_enabled: true,
      })
    ).toBe(false);
  });

  describe('bugfix: short numeric phones that pass isValidPhone after NG dial prefix', () => {
    it('rejects 12345 when courier pickup stays enabled', () => {
      expect(
        isMergedRepairPickupPhoneValid({
          pickup_enabled: true,
          contact_phone: '12345',
        })
      ).toBe(false);
    });
  });
});
