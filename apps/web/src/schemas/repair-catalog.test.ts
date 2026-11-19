import { describe, expect, it } from 'vitest';
import {
  repairsDeviceDetailRouteParamsSchema,
  repairsDevicesQuerySchema,
  repairsDevicesRouteParamsSchema,
} from './repair-catalog';

describe('repairsDevicesRouteParamsSchema', () => {
  it('accepts a valid lowercase-hyphenated store slug', () => {
    const result = repairsDevicesRouteParamsSchema.safeParse({
      slug: 'ogabassey-store',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a custom storefront domain', () => {
    const result = repairsDevicesRouteParamsSchema.safeParse({
      slug: 'repairs.example.com',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a slug with uppercase or invalid characters', () => {
    const result = repairsDevicesRouteParamsSchema.safeParse({
      slug: 'Ogabassey Store!',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a missing slug', () => {
    const result = repairsDevicesRouteParamsSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});

describe('repairsDeviceDetailRouteParamsSchema', () => {
  it('accepts a valid slug and device slug', () => {
    const result = repairsDeviceDetailRouteParamsSchema.safeParse({
      slug: 'ogabassey',
      deviceSlug: 'iphone-13',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a custom storefront domain and device slug', () => {
    const result = repairsDeviceDetailRouteParamsSchema.safeParse({
      slug: 'repairs.example.com',
      deviceSlug: 'iphone-13',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid device slug', () => {
    const result = repairsDeviceDetailRouteParamsSchema.safeParse({
      slug: 'ogabassey',
      deviceSlug: 'iPhone 13',
    });

    expect(result.success).toBe(false);
  });
});

describe('repairsDevicesQuerySchema', () => {
  it('defaults to an empty query and trims whitespace', () => {
    const result = repairsDevicesQuerySchema.safeParse({ q: '  iphone  ' });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.q).toBe('iphone');
    expect(result.data.mode).toBe('catalog');
  });

  it('allows an omitted query', () => {
    const result = repairsDevicesQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.q).toBeUndefined();
  });

  it('rejects an overly long query', () => {
    const result = repairsDevicesQuerySchema.safeParse({ q: 'a'.repeat(101) });

    expect(result.success).toBe(false);
  });

  it('accepts suggestion mode and rejects unknown modes', () => {
    expect(
      repairsDevicesQuerySchema.safeParse({ q: 'iphone', mode: 'suggestions' })
        .success
    ).toBe(true);
    expect(
      repairsDevicesQuerySchema.safeParse({ q: 'iphone', mode: 'other' })
        .success
    ).toBe(false);
  });
});
