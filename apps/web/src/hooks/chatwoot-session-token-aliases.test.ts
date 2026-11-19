import { describe, expect, it } from 'vitest';
import { rememberChatwootSessionToken } from './chatwoot-session-token-aliases';

describe('rememberChatwootSessionToken', () => {
  it('retains the initial and overlapping renewal tokens within a bounded set', () => {
    const aliases = new Set(['initial-token']);

    rememberChatwootSessionToken(aliases, 'renewal-a', 'initial-token');
    rememberChatwootSessionToken(aliases, 'renewal-b', 'initial-token');

    expect([...aliases]).toEqual(['initial-token', 'renewal-a', 'renewal-b']);

    for (let index = 0; index < 12; index += 1) {
      rememberChatwootSessionToken(
        aliases,
        `renewal-${index}`,
        'initial-token'
      );
    }

    expect(aliases.has('initial-token')).toBe(true);
    expect(aliases.has('renewal-11')).toBe(true);
    expect(aliases.size).toBeLessThanOrEqual(9);
  });
});
