import { describe, expect, it } from 'vitest';
import { domesticSendersDiffer } from './merchant-sender-comparison';

const baseSender = {
  name: 'Merchant',
  phone: '08000000000',
  address: '2 Olaide Tomori Street, Ikeja, Lagos, 100001',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

describe('domesticSendersDiffer', () => {
  it('returns false when city and state match after normalization', () => {
    expect(
      domesticSendersDiffer(baseSender, {
        ...baseSender,
        city: ' ikeja ',
        state: 'LAGOS',
      })
    ).toBe(false);
  });

  it('treats equivalent Abuja and FCT labels as the same origin', () => {
    expect(
      domesticSendersDiffer(
        { ...baseSender, city: 'Maitama', state: 'FCT - Abuja' },
        { ...baseSender, city: 'Maitama', state: 'Abuja (FCT)' }
      )
    ).toBe(false);
  });

  it('returns true when only the city differs', () => {
    expect(
      domesticSendersDiffer(baseSender, { ...baseSender, city: 'Lagos' })
    ).toBe(true);
  });

  it('returns true when only the state differs', () => {
    expect(
      domesticSendersDiffer(baseSender, { ...baseSender, state: 'Abuja' })
    ).toBe(true);
  });

  it('returns true when city and state match but country codes differ', () => {
    expect(
      domesticSendersDiffer(baseSender, {
        ...baseSender,
        country: 'Canada',
        countryCode: 'CA',
      })
    ).toBe(true);
  });

  it('treats equivalent Nigerian country codes as the same origin', () => {
    expect(
      domesticSendersDiffer({ ...baseSender, countryCode: 'NGA' }, baseSender)
    ).toBe(false);
  });

  it('returns true when city and state match but coordinates differ', () => {
    expect(
      domesticSendersDiffer(
        { ...baseSender, latitude: 6.45, longitude: 3.4 },
        { ...baseSender, latitude: 6.6, longitude: 3.35 }
      )
    ).toBe(true);
  });

  it('returns true when only one sender has coordinates', () => {
    expect(
      domesticSendersDiffer(
        { ...baseSender, latitude: 6.45, longitude: 3.4 },
        baseSender
      )
    ).toBe(true);
  });

  it('returns false when city, state, and coordinates all match', () => {
    expect(
      domesticSendersDiffer(
        { ...baseSender, latitude: 6.45, longitude: 3.4 },
        {
          ...baseSender,
          city: 'IKEJA',
          state: ' lagos ',
          latitude: 6.45,
          longitude: 3.4,
        }
      )
    ).toBe(false);
  });
});
