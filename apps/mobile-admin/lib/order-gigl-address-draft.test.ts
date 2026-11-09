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
  it('bugfix: clears the picked pin when the address is edited by hand', () => {
    const next = applyAddressField(picked, 'address', '12 Allen Ave');
    expect(next).toEqual({
      address: '12 Allen Ave',
      city: 'Ikeja',
      state: 'Lagos',
    });
  });

  it('keeps the pin when city is edited', () => {
    expect(applyAddressField(picked, 'city', 'Abuja').latitude).toBe(6.6);
  });

  it('replaces stale city, state and pin when a place has none', () => {
    const next = applySelectedPlace(picked, {
      address: 'Somewhere',
      city: '',
      state: '',
    });
    expect(next).toEqual({
      address: 'Somewhere',
      city: '',
      state: '',
      latitude: undefined,
      longitude: undefined,
    });
  });
});
