import { describe, expect, it } from 'vitest';
import { setJumiaDiscoveryRecoveryHeader } from './jumia-discovery-recovery-response';

describe('setJumiaDiscoveryRecoveryHeader', () => {
  it('exposes a recovery handle for failed or incomplete responses', () => {
    const response = Response.json(
      { error: 'connection failed' },
      { status: 502, headers: { 'x-jumia-discovery-complete': 'true' } }
    );

    expect(setJumiaDiscoveryRecoveryHeader(response, 'discovery-1')).toBe(true);
    expect(response.headers.get('x-jumia-discovery-id')).toBe('discovery-1');
  });

  it('does not expose a recovery handle after a complete successful response', () => {
    const response = Response.json(
      { connected: ['shop-1'] },
      { headers: { 'x-jumia-discovery-complete': 'true' } }
    );

    expect(setJumiaDiscoveryRecoveryHeader(response, 'discovery-1')).toBe(true);
    expect(response.headers.get('x-jumia-discovery-id')).toBeNull();
  });

  it('marks a response incomplete when the server asks the client to resume', () => {
    const response = Response.json(
      { connected: ['shop-1'] },
      { headers: { 'x-jumia-discovery-complete': 'false' } }
    );

    expect(setJumiaDiscoveryRecoveryHeader(response, 'discovery-1')).toBe(
      false
    );
    expect(response.headers.get('x-jumia-discovery-id')).toBe('discovery-1');
  });
});
