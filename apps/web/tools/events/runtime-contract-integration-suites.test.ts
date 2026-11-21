import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { runtimeIntegrationSuites } from './runtime-contract-integration-suites';
import { oxygenIntegrationSuites } from './runtime-contract-oxygen-integration-suites';

it('does not retain a web runtime mapping for the moved Oxygen order-plan schema', () => {
  expect(runtimeIntegrationSuites).not.toHaveProperty([
    'apps/web/src/schemas/oxygen-order-plan.ts',
  ]);
});

it('retains the split Oxygen associations and real behavioral suites in the composed registry', () => {
  expect(Object.keys(oxygenIntegrationSuites).length).toBeGreaterThan(0);
  for (const [source, suite] of Object.entries(oxygenIntegrationSuites)) {
    expect(runtimeIntegrationSuites[source]).toBe(suite);
    expect(existsSync(resolve('../..', source))).toBe(true);
    expect(existsSync(resolve('../..', suite))).toBe(true);
  }
});
