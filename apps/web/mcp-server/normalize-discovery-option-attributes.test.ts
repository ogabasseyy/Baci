import { expect, it } from 'vitest';
import { normalizeDiscoveryOptionAttributes } from './normalize-discovery-option-attributes';

it('normalizes catalog keys and canonical units without interpreting prose', () => {
  expect(normalizeDiscoveryOptionAttributes({ Storage: '1 TB', RAM: '8192MB', Colour: ' Blue ', Power: '20W' }))
    .toEqual({ storage_gb: 1024, ram_gb: 8, color: 'blue', power_w: 20 });
});
it('invalid overrides clear inherited facts and incompatible units remain unknown', () => {
  expect(normalizeDiscoveryOptionAttributes({ storage: 'up to 128GB', ram: '20W', color: null }))
    .toEqual({ storage_gb: null, ram_gb: null, color: null });
});

it('normalizes storefront RAM and memory suffix labels while rejecting unrelated suffixes', () => {
  expect(normalizeDiscoveryOptionAttributes({ ram: '64GB RAM' })).toEqual({ ram_gb: 64 });
  expect(normalizeDiscoveryOptionAttributes({ memory: '32 GB memory' })).toEqual({ ram_gb: 32 });
  expect(normalizeDiscoveryOptionAttributes({ ram: 'RAM 64GB' })).toEqual({ ram_gb: 64 });
  expect(normalizeDiscoveryOptionAttributes({ ram: '64GB SSD', storage: '64GB RAM', power: '20W RAM' }))
    .toEqual({ ram_gb: null, storage_gb: null, power_w: null });
});

it.each(['SSD', 'HDD', 'NVMe', 'eMMC'])('accepts the storefront storage-media suffix %s', (suffix) => {
  expect(normalizeDiscoveryOptionAttributes({ storage: `1TB ${suffix}` })).toEqual({ storage_gb: 1024 });
});
it('rejects storage marketing suffixes and media suffixes on other dimensions', () => {
  expect(normalizeDiscoveryOptionAttributes({ storage: '1TB fast', ram: '1TB SSD', power: '65W HDD' }))
    .toEqual({ storage_gb: null, ram_gb: null, power_w: null });
});
it('maps the shared commerce axis aliases storage_capacity and ram_options', () => {
  expect(normalizeDiscoveryOptionAttributes({ storage_capacity: '256GB', ram_options: '16GB' }))
    .toEqual({ storage_gb: 256, ram_gb: 16 });
});
it('preserves compatibility characters exactly as the matcher does', () => {
  expect(normalizeDiscoveryOptionAttributes({ color: "\uFF32\uFF45\uFF44" })).toEqual({ color: "\uFF52\uFF45\uFF44" });
});

it('resolves camelCase, dotted, and hyphenated axis spellings', () => {
  expect(normalizeDiscoveryOptionAttributes({ storageCapacity: '256GB', 'screen.inches': '6.5in', 'RAM-Options': '8GB' }))
    .toEqual({ storage_gb: 256, screen_inches: 6.5, ram_gb: 8 });
});
