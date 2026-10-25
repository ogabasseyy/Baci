import { describe, expect, it } from 'vitest';
import { getImeiDeviceProfile } from './device-profile';

describe('IMEI device identity', () => {
  it('separates the captured Apple model, colour and storage', () => {
    expect(
      getImeiDeviceProfile({
        device: 'iPhone 17 Pro Max 512GB Silver',
        color: 'Silver',
      })
    ).toMatchObject({
      brand: 'Apple',
      model: 'iPhone 17 Pro Max',
      color: 'Silver',
      storage: '512GB',
    });
  });
  it('does not classify a bare serial as a device model', () => {
    expect(getImeiDeviceProfile({ device: 'F2LDN12345' }).model).toBeNull();
  });
  it('normalizes colour spelling before matching Android models', () => {
    expect(
      getImeiDeviceProfile({ device: 'Samsung Galaxy S24 Ultra Titanium Grey' })
    ).toMatchObject({ model: 'Galaxy S24 Ultra', color: 'Titanium Gray' });
  });

  it('does not copy an identifier into model analytics', () => {
    expect(
      getImeiDeviceProfile({ device: 'Unknown device 490154203237518' }).model
    ).toBeNull();
  });

  it('keeps unknown values unknown instead of inventing a variant', () => {
    expect(getImeiDeviceProfile({ device: 'Unknown Device' })).toMatchObject({
      brand: null,
      model: null,
      color: null,
      storage: null,
    });
    expect(
      getImeiDeviceProfile({ device: 'Samsung Galaxy S24 Ultra' })
    ).toMatchObject({
      brand: 'Samsung',
      model: 'Galaxy S24 Ultra',
      color: null,
    });
  });
});

it.each([
  'F2LDN12345',
  'f2ldn12345',
  'F2LDN1234567A',
  'Apple F2LDN12345',
  'Apple F2LDN12345 512GB Silver',
])('does not promote an opaque serial into model analytics when a brand is reported: %s', (device) => {
  expect(getImeiDeviceProfile({ device, brand: 'Apple' })).toMatchObject({
    brand: 'Apple',
    model: null,
  });
});
it.each([
  { device: 'SM-S928B', brand: 'Samsung' },
  { device: 'CPH2609', brand: 'OPPO' },
])('preserves observed model codes with a reported manufacturer: %j', (input) => {
  expect(getImeiDeviceProfile(input)).toMatchObject({
    brand: input.brand,
    model: input.device,
  });
});

it.each([
  'Apple',
  'Apple 512GB Silver',
  'Samsung',
  'Samsung 256GB Black',
])('does not report a brand-only device as a model: %s', (device) => {
  expect(getImeiDeviceProfile({ device }).model).toBeNull();
});
