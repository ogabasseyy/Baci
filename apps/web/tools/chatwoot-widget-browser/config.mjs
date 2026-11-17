import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
export const storefrontHost = '::1';
export const storefrontAuthority = 'localhost';
export const storefrontPort = Number(
  process.env.CHATWOOT_FIXTURE_STOREFRONT_PORT ?? 43128
);
export const resetDelayMs = Number(
  process.env.CHATWOOT_FIXTURE_RESET_DELAY_MS ?? '300'
);
export const platformPort = Number(
  process.env.CHATWOOT_FIXTURE_PLATFORM_PORT ?? 43129
);
export const storefrontOrigin = `https://${storefrontAuthority}:${storefrontPort}`;
export const platformOrigin = `https://${storefrontAuthority}:${platformPort}`;
export const chatwootHttpOrigin = 'http://127.0.0.1:43119';

export const tokenFile = process.env.CHATWOOT_SYNTHETIC_TOKENS_FILE;
export const fileTokens = tokenFile
  ? JSON.parse(await readFile(tokenFile, 'utf8'))
  : {};
export const tokenA = process.env.CHATWOOT_SYNTHETIC_TOKEN_A ?? fileTokens.a;
export const tokenB = process.env.CHATWOOT_SYNTHETIC_TOKEN_B ?? fileTokens.b;
export const publicTokenPattern = /^[A-Za-z0-9_-]{16,128}$/;
if (
  typeof tokenA !== 'string' ||
  typeof tokenB !== 'string' ||
  !publicTokenPattern.test(tokenA) ||
  !publicTokenPattern.test(tokenB) ||
  tokenA === tokenB
) {
  throw new Error('Provide two distinct synthetic Chatwoot website tokens');
}
if (
  !Number.isInteger(resetDelayMs) ||
  resetDelayMs < 0 ||
  resetDelayMs > 2000
) {
  throw new Error('Synthetic reset delay must be an integer from 0 to 2000 ms');
}
process.env.CHATWOOT_FIXTURE_RESET_DELAY_MS = String(resetDelayMs);
