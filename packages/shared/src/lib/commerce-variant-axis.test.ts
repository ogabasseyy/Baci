import { describe, expect, it } from 'vitest';
import {
  canonicalizeCommerceVariantAxis,
  getCommerceVariantAxes,
  normalizeCommerceVariantOption,
} from './commerce-variant-axis';

describe('commerce variant axis contract', () => {
  it('keeps purchasable dimensions and rejects descriptive specifications', () => {
    expect(
      getCommerceVariantAxes({
        camera: ['Webcam'],
        condition: ['used'],
        display_type: ['16-inch display'],
        gpu: ['RTX 4070'],
        graphics: ['RTX 4070'],
        keyboard: ['Backlit keyboard'],
        material: ['Aluminum', 'Plastic'],
        model_number: ['DYMSR54'],
        operating_system: ['Windows 11 Pro'],
        processor: ['Intel Core Ultra 7 155H'],
        ram: ['64GB RAM'],
        screen_size: ['16-inch'],
        storage: ['1TB SSD'],
        style: ['Classic'],
        wireless: ['Wi-Fi 7'],
      })
    ).toEqual([
      'condition',
      'graphics',
      'material',
      'processor',
      'ram',
      'storage',
      'style',
    ]);
  });

  it('canonicalizes legacy commerce aliases without exposing metadata aliases', () => {
    expect(canonicalizeCommerceVariantAxis('Colour')).toBe('color');
    expect(canonicalizeCommerceVariantAxis('GPU')).toBe('graphics');
    expect(canonicalizeCommerceVariantAxis('Display Size')).toBeNull();
    expect(canonicalizeCommerceVariantAxis('RAM Options')).toBe('ram');
    expect(canonicalizeCommerceVariantAxis('Operating System')).toBeNull();
    expect(canonicalizeCommerceVariantAxis('Color Hex')).toBeNull();
    expect(canonicalizeCommerceVariantAxis('colorhex')).toBeNull();
    expect(canonicalizeCommerceVariantAxis('colourhex')).toBeNull();
    expect(canonicalizeCommerceVariantAxis('sku')).toBeNull();
    expect(canonicalizeCommerceVariantAxis('variant_id')).toBeNull();
    expect(canonicalizeCommerceVariantAxis('price')).toBeNull();
    expect(canonicalizeCommerceVariantAxis('material')).toBe('material');
    expect(canonicalizeCommerceVariantAxis('flavor')).toBe('flavor');
    expect(canonicalizeCommerceVariantAxis('Warranty')).toBe('warranty');
    expect(canonicalizeCommerceVariantAxis('specs.esim')).toBeNull();
  });

  it('normalizes equivalent laptop option labels before matrix matching', () => {
    expect(
      normalizeCommerceVariantOption(
        'graphics',
        '8GB NVIDIA GeForce RTX 4070 Graphics'
      )
    ).toBe('NVIDIA GeForce RTX 4070 8GB');
    expect(normalizeCommerceVariantOption('gpu', '8GB RTX 4070 Graphics')).toBe(
      'NVIDIA GeForce RTX 4070 8GB'
    );
    expect(
      normalizeCommerceVariantOption(
        'graphics',
        'RTX 4070 Laptop GPU 8GB 115W'
      )
    ).toBe('NVIDIA GeForce RTX 4070 8GB Laptop 115W');
    expect(
      normalizeCommerceVariantOption(
        'graphics',
        'RTX 4070 Laptop GPU 8GB 140W'
      )
    ).toBe('NVIDIA GeForce RTX 4070 8GB Laptop 140W');
    expect(
      normalizeCommerceVariantOption(
        'graphics',
        'RTX 4070 Laptop GPU 8GB 115W'
      )
    ).not.toBe(
      normalizeCommerceVariantOption(
        'graphics',
        'RTX 4070 Laptop GPU 8GB 140W'
      )
    );
    expect(
      normalizeCommerceVariantOption('processor', 'Intel Ultra 7 155H')
    ).toBe('Intel Core Ultra 7 155H');
    expect(normalizeCommerceVariantOption('ram', '64GB RAM')).toBe('64GB');
    expect(normalizeCommerceVariantOption('ram', '64 GB RAM')).toBe('64GB');
    expect(normalizeCommerceVariantOption('storage', '1TB SSD')).toBe(
      '1TB SSD'
    );
    expect(normalizeCommerceVariantOption('storage', '1 TB HDD')).toBe(
      '1TB HDD'
    );
    expect(normalizeCommerceVariantOption('storage', '512 GB')).toBe('512GB');
  });

  it('preserves storage medium so SSD and HDD stay distinct purchase options', () => {
    expect(normalizeCommerceVariantOption('storage', '1TB SSD')).not.toBe(
      normalizeCommerceVariantOption('storage', '1TB HDD')
    );
  });

  it('uses safe variant-backed axes only when a parent declaration is absent', () => {
    expect(
      getCommerceVariantAxes(null, ['storage', 'camera', 'model', 'processor'])
    ).toEqual(['storage', 'processor']);
  });

  it('adds safe live axes that are missing from a stale parent declaration', () => {
    expect(
      getCommerceVariantAxes({ storage: ['256GB'] }, [
        'storage',
        'ram',
        'operating_system',
        'flavor',
      ])
    ).toEqual(['storage', 'ram', 'flavor']);
  });
});
