import { expect, it } from 'vitest';
import { intentWords } from './discovery-intent-words';
it('preserves USB subtypes and wireless spelling across separators', () => {
  expect(intentWords('USB-C USB C USBC USB-A USB A Wi-Fi')).toEqual(['usbc', 'usbc', 'usbc', 'usba', 'usba', 'wifi']);
  expect(intentWords('USB Charger')).toEqual(['usb', 'charger']);
});
