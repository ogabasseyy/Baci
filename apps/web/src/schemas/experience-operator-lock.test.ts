import { expect, it } from 'vitest';
import {
  operatorLockDependencies,
  operatorLockDependency,
  operatorNextVersion,
  operatorPackageManager,
  pinnedOperatorPnpm,
} from './experience-operator-lock';

it('reads fixed dependency and package-manager locators from lock inputs', () => {
  const next = { specifier: '16.4.5', version: '16.4.5' };
  expect(operatorLockDependency.parse(next)).toEqual(next);
  expect(operatorNextVersion.parse(next)).toEqual({ version: next.version });
  expect(operatorLockDependencies.parse({ next: next.version })).toEqual({
    next: next.version,
  });
  const packageManager = operatorPackageManager.parse({
    packageManager: 'pnpm@11.22.0',
  });
  expect(pinnedOperatorPnpm.parse(packageManager.packageManager)).toBe(
    'pnpm@11.22.0'
  );
  expect(pinnedOperatorPnpm.safeParse('pnpm@latest').success).toBe(false);
  expect(operatorLockDependency.safeParse({ version: 16 }).success).toBe(false);
});
