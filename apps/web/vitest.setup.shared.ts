import { beforeEach, vi } from 'vitest';
import { resetProviderCooldowns } from '@/ai/provider-cooldown';

/**
 * Setup every web test needs, whichever Vitest project runs it (`jsdom` or
 * `node`, see vitest.config.ts). Keep DOM-only work in vitest.setup.ts so
 * tests that never touch a DOM do not pay for it.
 */
export function installSharedTestSetup(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key';

  // The AI provider chain parks rate-limited providers in a module-level
  // cooldown Map (src/ai/provider-cooldown.ts). Any test that simulates a
  // quota/429 rejection would otherwise leak that cooldown into the tests that
  // follow it in the same file, silently changing which provider the chain
  // attempts. Reset it globally so each test starts from a clean chain.
  let deterministicUuidCounter = 0;

  beforeEach(() => {
    resetProviderCooldowns();
    // Deterministic UUIDs for every suite: repo rules prohibit random
    // test data, and production helpers generate UUIDs internally
    // (operation ids, cart client credentials). A counter-based v4
    // sequence keeps values distinct yet reproducible; suites that
    // stub crypto.randomUUID themselves override this per test. The
    // counter is monotonic per file (never reset) so values also stay
    // distinct across tests sharing accumulated mock calls.
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      vi.spyOn(crypto, 'randomUUID').mockImplementation(
        () =>
          `00000000-0000-4000-8000-${(deterministicUuidCounter++)
            .toString(16)
            .padStart(
              12,
              '0'
            )}` as `${string}-${string}-${string}-${string}-${string}`
      );
    }
  });
}
