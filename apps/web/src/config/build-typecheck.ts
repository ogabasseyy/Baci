import type { NextConfig } from 'next';

// Native TypeScript defaults to four checker instances. Use the extending
// build config to bound their memory without dropping files or strict checks.
export const BUILD_TYPESCRIPT_CONFIG = {
  tsconfigPath: 'tsconfig.build.json',
  ignoreBuildErrors: false,
} satisfies NonNullable<NextConfig['typescript']>;

// TypeScript 7 has no JavaScript compiler API. Keep Next on its CLI path;
// the repository retains TypeScript 6 solely for API consumers.
export const BUILD_TYPESCRIPT_EXPERIMENTS = {
  useTypeScriptCli: true,
} satisfies NonNullable<NextConfig['experimental']>;
