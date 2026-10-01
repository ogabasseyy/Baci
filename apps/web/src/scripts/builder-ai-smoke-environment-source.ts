import { execFileSync } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export interface BuilderAiSmokeEnvironmentSourceDependencies {
  isIgnored: (relativePath: string) => Promise<boolean>;
  lstat: typeof lstat;
  primaryCheckout: string;
  realpath: typeof realpath;
}

function resolvePrimaryCheckout(): string {
  const commonDirectory = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
  return path.dirname(path.resolve(process.cwd(), commonDirectory));
}

function defaultDependencies(): BuilderAiSmokeEnvironmentSourceDependencies {
  const primaryCheckout = resolvePrimaryCheckout();
  return {
    isIgnored: async (relativePath) => {
      try {
        execFileSync('git', ['check-ignore', '-q', '--', relativePath], {
          cwd: primaryCheckout,
          stdio: 'ignore',
        });
        return true;
      } catch {
        return false;
      }
    },
    lstat,
    primaryCheckout,
    realpath,
  };
}

export async function validateBuilderAiSmokeEnvironmentSource(
  source: string | undefined,
  dependencies = defaultDependencies()
): Promise<{ path: string } | null> {
  if (!source || !path.isAbsolute(source)) return null;
  try {
    const primary = await dependencies.realpath(dependencies.primaryCheckout);
    const requested = path.resolve(source);
    const allowed = [path.join(primary, 'apps/web/.env'), path.join(primary, 'apps/web/.env.local')];
    if (!allowed.includes(requested)) return null;
    const status = await dependencies.lstat(requested);
    if (!status.isFile() || status.isSymbolicLink()) return null;
    if ((await dependencies.realpath(requested)) !== requested) return null;
    if (!(await dependencies.isIgnored(path.relative(primary, requested)))) return null;
    return { path: requested };
  } catch {
    return null;
  }
}
