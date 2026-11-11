import { describe, expect, it } from 'vitest';
import {
  isProviderCoolingDown,
  recordProviderFailure,
} from '@/ai/provider-cooldown';

const PROVIDER = 'node-project-wiring-test';
const UUID_PATTERN = /^00000000-0000-4000-8000-([0-9a-f]{12})$/;

// This file lives in a folder listed in vitest.node-folders.ts, so it runs in
// the `node` Vitest project: Node globals and vitest.setup.node.ts only.
describe('node Vitest project wiring', () => {
  it('runs in Node without a DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('leaves out the jest-dom matchers only the jsdom setup registers', () => {
    const assertion = expect(1) as unknown as Record<string, unknown>;

    expect(() => assertion.toBeInTheDocument).toThrow();
  });

  it('uses the native Web APIs that API route tests rely on', () => {
    expect(new Blob(['x']).arrayBuffer).toBeTypeOf('function');
    expect(new File(['x'], 'a.txt').name).toBe('a.txt');
    const form = new FormData();
    form.append('file', new File(['x'], 'a.txt'));
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('stubs server-only so server modules can be imported', async () => {
    // The real package throws outside React Server Components. A variable
    // specifier avoids needing type declarations for it.
    const serverOnly = 'server-only';

    await expect(import(/* @vite-ignore */ serverOnly)).resolves.toBeDefined();
  });

  it('defaults the public Supabase env read when modules load', () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeTruthy();
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeTruthy();
  });

  it('hands out deterministic, increasing UUIDs', () => {
    const first = UUID_PATTERN.exec(crypto.randomUUID());
    const second = UUID_PATTERN.exec(crypto.randomUUID());

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Number.parseInt(second?.[1] ?? '', 16)).toBe(
      Number.parseInt(first?.[1] ?? '', 16) + 1
    );
  });

  describe('provider cooldown isolation', () => {
    it('parks a provider after a rate-limit rejection', () => {
      recordProviderFailure(PROVIDER, new Error('rate limit exceeded'));

      expect(isProviderCoolingDown(PROVIDER)).toBe(true);
    });

    it('starts the next test with a clean cooldown map', () => {
      expect(isProviderCoolingDown(PROVIDER)).toBe(false);
    });
  });
});
