import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_PHRASES,
  setupInteractionTests,
} from './use-oxygen-interaction.test-helpers';

setupInteractionTests();

describe('use-oxygen-interaction module shape (static)', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      'src/components/payments/oxygen/use-oxygen-interaction.ts'
    ),
    'utf8'
  );

  it('is a client module', () => {
    expect(source).toContain("'use client'");
  });

  it('never fetches and never touches routing or foreign stores', () => {
    expect(source).not.toContain('global.fetch');
    expect(source).not.toMatch(/(^|[^A-Za-z])fetch\(/m);
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('next/router');
    expect(source).not.toContain('next/navigation');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('transport');
    expect(source).not.toContain('token-cache');
    expect(source).not.toContain('posthog');
    expect(source).not.toContain('captureClientEvent');
  });

  it('keeps approval language out of the module', () => {
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(source.toLowerCase()).not.toContain(phrase);
    }
  });

  it('mentions no provider, loan, attempt, or chat-transcript surface', () => {
    expect(source).not.toMatch(/provider/i);
    expect(source).not.toMatch(/loan/i);
    expect(source).not.toContain('attemptId');
    expect(source).not.toContain('transcript');
  });
});
