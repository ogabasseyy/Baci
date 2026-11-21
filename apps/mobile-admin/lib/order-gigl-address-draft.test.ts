import { describe, expect, it } from 'vitest';
import {
  applyAddressField,
  applySelectedPlace,
} from './order-gigl-address-draft';

const picked = {
  address: '12 Allen',
  city: 'Ikeja',
  state: 'Lagos',
  latitude: 6.6,
  longitude: 3.35,
};

describe('order-gigl-address-draft', () => {
  it('requires fresh locality when the street destination changes by hand', () => {
    const next = applyAddressField(picked, 'address', '12 Allen Ave');
    expect(next).toEqual({
      address: '12 Allen Ave',
      city: '',
      state: '',
    });
  });

  it('preserves locality and pin for formatting-only street edits', () => {
    expect(applyAddressField(picked, 'address', '12 Allen,')).toEqual({
      ...picked,
      address: '12 Allen,',
    });
  });

  it('clears the pin when city or state is edited by hand', () => {
    expect(applyAddressField(picked, 'city', 'Abuja').latitude).toBeUndefined();
    expect('latitude' in applyAddressField(picked, 'state', 'Ogun')).toBe(
      false
    );
  });

  it('keeps the pin when the phone is edited', () => {
    expect(applyAddressField(picked, 'phone', '0801').latitude).toBe(6.6);
  });

  it('replaces stale city, state and pin when a place has none', () => {
    const next = applySelectedPlace(picked, {
      address: 'Somewhere',
      city: '',
      state: '',
    });
    expect(next).toEqual({ address: 'Somewhere', city: '', state: '' });
    expect('latitude' in next).toBe(false);
  });

  it('drops an out-of-range or non-finite pin from a selected place', () => {
    const base = { address: 'X', city: 'A', state: 'B' };
    expect(
      'latitude' in
        applySelectedPlace({}, { ...base, latitude: 91, longitude: 3 })
    ).toBe(false);
    expect(
      'latitude' in
        applySelectedPlace({}, { ...base, latitude: Number.NaN, longitude: 3 })
    ).toBe(false);
  });
});
