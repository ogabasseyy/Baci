// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getKlumpConstructor,
  getKlumpPublicKey,
  loadKlumpSdk,
  resetKlumpSdkLoadForTests,
} from '@/lib/klump-sdk';

const mockKlumpConstructor = vi.fn();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetKlumpSdkLoadForTests();
  window.Klump = undefined;
  document
    .querySelectorAll('script[src="https://js.useklump.com/klump.js"]')
    .forEach((script) => {
      script.remove();
    });
});

describe('klump-sdk', () => {
  it('reads the public key from the supported environment variables', () => {
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    expect(getKlumpPublicKey()).toBe('klp_pk_test_123');
  });

  it('returns the Klump constructor when it is attached to window', () => {
    window.Klump = mockKlumpConstructor as never;

    expect(getKlumpConstructor()).toBe(mockKlumpConstructor);
  });

  it('loads the Klump SDK script when no constructor is available', async () => {
    const originalAppendChild = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation(
      <T extends Node>(node: T): T => {
        const result = originalAppendChild(node);
        if (
          node instanceof HTMLScriptElement &&
          node.src === 'https://js.useklump.com/klump.js'
        ) {
          window.Klump = mockKlumpConstructor as never;
          node.dispatchEvent(new Event('load'));
        }
        return result;
      }
    );

    await expect(loadKlumpSdk()).resolves.toBeUndefined();
    expect(getKlumpConstructor()).toBe(mockKlumpConstructor);
  });

  it('rejects when the Klump script fails to load', async () => {
    const originalAppendChild = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation(
      <T extends Node>(node: T): T => {
        const result = originalAppendChild(node);
        if (
          node instanceof HTMLScriptElement &&
          node.src === 'https://js.useklump.com/klump.js'
        ) {
          queueMicrotask(() => node.dispatchEvent(new Event('error')));
        }
        return result;
      }
    );

    await expect(loadKlumpSdk()).rejects.toThrow('Failed to load Klump script');
  });
});
