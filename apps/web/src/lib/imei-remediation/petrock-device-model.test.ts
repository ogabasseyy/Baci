import { describe, expect, it } from 'vitest';
import {
  matchesPetrockModelScope,
  normalizePetrockDeviceModel,
  parsePetrockModelScope,
} from './petrock-device-model';

describe('Petrock remediation device model matching', () => {
  it('normalizes an Apple generation string to an iPhone series', () => {
    expect(
      normalizePetrockDeviceModel('IPHONE 17 PRO MAX (A3525)', 'IPHONE18,2')
    ).toMatchObject({ family: 'iphone', series: 17 });
  });

  it('matches ranges and fails closed on an ambiguous model', () => {
    expect(
      matchesPetrockModelScope(
        { canonical: 'iphone-17', family: 'iphone', series: 17 },
        { kind: 'range', max: 17, min: 16 }
      )
    ).toBe(true);
    expect(
      matchesPetrockModelScope(
        { canonical: '', family: 'unknown', series: null },
        { family: 'iphone', kind: 'generic' }
      )
    ).toBe(false);
  });

  it('validates persisted model scopes at the database boundary', () => {
    expect(
      parsePetrockModelScope({
        family: 'iphone',
        kind: 'range',
        max: 17,
        min: 16,
      })
    ).toEqual({ family: 'iphone', kind: 'range', max: 17, min: 16 });
    expect(
      parsePetrockModelScope({ kind: 'set', models: ['iphone-17'] })
    ).toEqual({ kind: 'set', models: ['iphone-17'] });
  });

  it.each([
    null,
    { kind: 'range', max: 15, min: 17 },
    { kind: 'range', max: '17', min: 16 },
    { kind: 'set', models: [] },
    { kind: 'set', models: [''] },
    { kind: 'unknown' },
  ])('rejects a malformed persisted model scope', (scope) => {
    expect(parsePetrockModelScope(scope)).toBeNull();
  });
});

it('distinguishes exact iPhone variants while retaining series-wide ranges', () => {
  const base = normalizePetrockDeviceModel('iPhone 17');
  const pro = normalizePetrockDeviceModel('iPhone 17 Pro');
  const max = normalizePetrockDeviceModel('iPhone 17 Pro Max (A3525)');
  expect(base.canonical).toBe('iphone-17');
  expect(pro.canonical).toBe('iphone-17-pro');
  expect(max.canonical).toBe('iphone-17-pro-max');
  expect(
    matchesPetrockModelScope(max, { kind: 'set', models: ['iphone-17'] })
  ).toBe(false);
  expect(
    matchesPetrockModelScope(max, {
      kind: 'set',
      models: ['iphone-17-pro-max'],
    })
  ).toBe(true);
  expect(
    matchesPetrockModelScope(max, {
      kind: 'range',
      family: 'iphone',
      min: 17,
      max: 17,
    })
  ).toBe(true);
});

it.each([
  'iPhone 17 Ultra',
  'iPhone 17 Pro Max 512GB',
  'iPhone 17 Pro Ultra',
])('fails closed for an ambiguous exact model: %s', (name) => {
  const model = normalizePetrockDeviceModel(name);
  expect(
    matchesPetrockModelScope(model, {
      kind: 'set',
      models: ['iphone-17', 'iphone-17-pro'],
    })
  ).toBe(false);
  expect(
    matchesPetrockModelScope(model, {
      kind: 'range',
      family: 'iphone',
      min: 17,
      max: 17,
    })
  ).toBe(true);
});

it.each([
  'Samsung Galaxy S25 Ultra',
  'iPad Pro 11',
])('does not approve an unverified exact scope for %s', (name) => {
  expect(
    matchesPetrockModelScope(normalizePetrockDeviceModel(name), {
      kind: 'set',
      models: ['samsung-s25', 'ipad-11'],
    })
  ).toBe(false);
});
it('does not match an empty canonical value in a malformed set', () => {
  expect(
    matchesPetrockModelScope(normalizePetrockDeviceModel('iPhone 17 Ultra'), {
      kind: 'set',
      models: [''],
    })
  ).toBe(false);
});

it.each([
  '',
  'Unknown',
  'Unknown Device',
  'N/A',
])('does not match a generic scope with placeholder model %s', (value) => {
  expect(
    matchesPetrockModelScope(normalizePetrockDeviceModel(value), {
      kind: 'generic',
    })
  ).toBe(false);
});
it('does not treat iPad screen size as an iPhone series range', () => {
  expect(
    matchesPetrockModelScope(normalizePetrockDeviceModel('iPad Pro 11'), {
      kind: 'range',
      min: 11,
      max: 11,
    })
  ).toBe(false);
});

it('does not use Apple internal hardware identifiers as marketing generations', () => {
  expect(
    matchesPetrockModelScope(normalizePetrockDeviceModel('iPhone18,2'), {
      kind: 'range',
      family: 'iphone',
      min: 18,
      max: 18,
    })
  ).toBe(false);
  expect(
    matchesPetrockModelScope(
      normalizePetrockDeviceModel('Unknown Device', 'iPhone18,2'),
      { kind: 'generic' }
    )
  ).toBe(false);
});

it('does not let a secondary hardware identifier change the device family', () => {
  const model = normalizePetrockDeviceModel('Samsung Galaxy S25', 'iPhone18,2');
  expect(model.family).toBe('samsung');
  expect(
    matchesPetrockModelScope(model, {
      kind: 'range',
      family: 'iphone',
      min: 18,
      max: 18,
    })
  ).toBe(false);
});
