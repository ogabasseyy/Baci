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
