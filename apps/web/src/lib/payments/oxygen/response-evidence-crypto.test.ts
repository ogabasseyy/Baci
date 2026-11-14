import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { projectOxygenResponse } from './response-evidence';
import {
  decryptOxygenResponse,
  encryptOxygenResponse,
} from './response-evidence-crypto';

it('binds encrypted evidence to its workflow, command, and sequence', () => {
  const payload = projectOxygenResponse(
    {
      operation: 'payment',
      httpStatus: 200,
      requestId: null,
      capture: 'parsed',
      durationMs: 2,
    },
    new Set()
  );
  const key = 'ab'.repeat(32);
  const ciphertext = encryptOxygenResponse(
    payload,
    key,
    'workflow',
    'command',
    1
  );
  expect(
    decryptOxygenResponse(ciphertext, key, 'workflow', 'command', 1)
  ).toEqual(payload);
  expect(() =>
    decryptOxygenResponse(ciphertext, key, 'other', 'command', 1)
  ).toThrow();
  expect(() =>
    decryptOxygenResponse(ciphertext, key, 'workflow', 'other', 1)
  ).toThrow();
  expect(() =>
    decryptOxygenResponse(ciphertext, key, 'workflow', 'command', 2)
  ).toThrow();
});
