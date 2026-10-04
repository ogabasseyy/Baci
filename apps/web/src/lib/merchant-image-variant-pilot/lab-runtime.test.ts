import { afterEach, expect, it } from 'vitest';
import type { PilotLabConfig } from './lab-config';
import { getFrozenLabRuntime, publishLabRuntime } from './lab-runtime';

afterEach(() => {
  Reflect.deleteProperty(
    globalThis,
    Symbol.for('baci.merchant-image-pilot.runtime')
  );
});

it('refuses requests until startup publishes a validated snapshot', () => {
  expect(() => getFrozenLabRuntime()).toThrow(/startup validation/);
});

it('serves the same snapshot and refuses replacement during a frozen run', () => {
  const config = Object.freeze({}) as PilotLabConfig;
  publishLabRuntime(config);
  expect(getFrozenLabRuntime()).toBe(config);
  expect(getFrozenLabRuntime()).toBe(config);
  expect(() => publishLabRuntime(config)).toThrow(/restart/);
});
