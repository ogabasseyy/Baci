import { z } from 'zod';

export const operatorLockRecord = z.record(z.string(), z.unknown());
export const operatorLockDependency = z.object({
  specifier: z.string(),
  version: z.string(),
});
export const operatorLockDependencies = z.record(z.string(), z.string());
export const operatorNextVersion = z.object({ version: z.string() });
export const operatorPackageManager = z.object({ packageManager: z.string() });
export const pinnedOperatorPnpm = z.string().regex(/^pnpm@\d+\.\d+\.\d+$/);
