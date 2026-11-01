import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readFileSync } from 'node:fs';
import { decryptOxygenDraft, encryptOxygenDraft } from './draft-crypto';
import { decryptPhoneTarget, encryptPhoneTarget } from './phone-handoff-crypto';
import { redactOxygenDiagnosticText } from './redact-diagnostic';
import {
  decryptOxygenResponse,
  encryptOxygenResponse,
  projectOxygenResponse,
} from './response-evidence';

it('uses a full GCM tag and rejects truncated and overlong tags for all encrypted records', () => {
  const key = 'ab'.repeat(32);
  const draftContext = { userId: 'user', workflowId: 'workflow', version: 1 };
  const phoneContext = {
    hash: 'c'.repeat(64),
    workflowId: 'workflow',
    applicationReference: 'application',
    environment: 'staging' as const,
  };
  const draft = { step: 0 as const, fields: {} };
  const target = 'https://selfie.example.test';
  const evidence = projectOxygenResponse(
    {
      operation: 'book',
      httpStatus: 200,
      requestId: null,
      capture: 'parsed',
      durationMs: 1,
      body: {},
    },
    new Set()
  );
  const cases = [
    {
      payload: encryptOxygenDraft(draft, key, draftContext),
      read: (value: string) => decryptOxygenDraft(value, key, draftContext),
      expected: draft,
    },
    {
      payload: encryptPhoneTarget(target, key, phoneContext),
      read: (value: string) => decryptPhoneTarget(value, key, phoneContext),
      expected: target,
    },
    {
      payload: encryptOxygenResponse(evidence, key, 'workflow', 'command', 1),
      read: (value: string) =>
        decryptOxygenResponse(value, key, 'workflow', 'command', 1),
      expected: evidence,
    },
  ];
  for (const entry of cases) {
    expect(entry.read(entry.payload)).toEqual(entry.expected);
    for (const length of [12, 17]) {
      const parts = entry.payload.split('.');
      parts[2] = Buffer.alloc(length).toString('base64url');
      expect(() => entry.read(parts.join('.'))).toThrow();
    }
  }
  for (const file of [
    'draft-crypto.ts',
    'phone-handoff-crypto.ts',
    'response-evidence.ts',
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source).toMatch(/createDecipheriv\([\s\S]*?authTagLength:\s*16/);
  }
});

it('redacts literal secrets case insensitively without compiling them as patterns', () => {
  const original = globalThis.RegExp;
  const spy = vi.spyOn(globalThis, 'RegExp').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('a\\.b'))
      throw new Error('dynamic secret pattern');
    return new original(...args);
  });
  try {
    expect(redactOxygenDiagnosticText('A.B a.b axb', {}, ['a.b'], false)).toBe(
      '[redacted] [redacted] axb'
    );
    expect(
      redactOxygenDiagnosticText('Ada A a ẞ ß', { name: 'a' }, ['ẞ'], false)
    ).toBe('Ada [redacted] [redacted] [redacted] [redacted]');
    expect(
      redactOxygenDiagnosticText(
        'Key kEY ſign SIGN ı i',
        {},
        ['key', 'sign', 'i'],
        false
      )
    ).toBe('[redacted] [redacted] [redacted] [redacted] ı [redacted]');
    expect(
      redactOxygenDiagnosticText(
        'ΐfoo ΰfoo ﬆfoo',
        {},
        ['ΐfoo', 'ΰfoo', 'ﬅfoo'],
        false
      )
    ).toBe('[redacted] [redacted] [redacted]');
    expect(
      redactOxygenDiagnosticText('ba ab ab!2', { name: 'ab' }, [], false)
    ).toBe('ba [redacted] [redacted]!2');
  } finally {
    spy.mockRestore();
  }
});
