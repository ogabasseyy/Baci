import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PHRASES } from './interaction.test-helpers';

describe('interaction module shape (static)', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/lib/payments/oxygen/interaction.ts'),
    'utf8'
  );

  it('imports nothing: framework-agnostic core', () => {
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toContain('require(');
  });

  it('touches no React, provider, storage, network, or telemetry surface', () => {
    expect(source).not.toContain('React');
    expect(source).not.toContain('transport');
    expect(source).not.toContain('token-cache');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('posthog');
    expect(source).not.toContain('captureClientEvent');
    expect(source).not.toContain('console');
    expect(source).not.toContain('process.env');
    expect(source).not.toContain('typeof window');
    expect(source).not.toContain('window.sessionStorage');
    expect(source).not.toContain('window.localStorage');
  });

  it('keeps approval language out of the module', () => {
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(source.toLowerCase()).not.toContain(phrase);
    }
  });
});
