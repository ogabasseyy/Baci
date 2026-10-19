import { describe, expect, it } from 'vitest';
import { supabaseReplayFailureDiagnostic } from './supabase-replay-failure-diagnostic';

describe('supabaseReplayFailureDiagnostic', () => {
  it.each([
    ['failed to connect to postgres: connection refused', 'connection-refused'],
    ['Connection Refused', 'connection-refused'],
    ['connection refused: no space left on device', 'connection-refused'],
    ['bind: address already in use', 'port-conflict'],
    ['port is already allocated', 'port-conflict'],
    ['client version is too old', 'docker-api'],
    ['minimum supported API version is 1.44', 'docker-api'],
    ['no space left on device', 'disk-full'],
    ['failed to pull image', 'image-pull'],
    ['pull access denied', 'image-pull'],
    ['failed to resolve reference', 'image-pull'],
    ['toomanyrequests', 'image-pull'],
    ['failed to create docker container', 'container-create'],
    ['container unhealthy', 'container-health'],
    ['health check failed', 'container-health'],
    ['ERROR: permission denied (SQLSTATE 42501)', 'postgres-42501'],
    ['x SQLSTATE 42501 y', 'postgres-42501'],
  ])('returns only a fixed category for %s', (message, diagnostic) => {
    const secret =
      'https://user:private-password@db.example token=private-value';
    expect(supabaseReplayFailureDiagnostic(`${message}\n${secret}`)).toBe(
      ` (diagnostic=${diagnostic})`
    );
  });

  it.each([
    '',
    'token=private-value https://user:private-password@db.example',
    'SQLSTATE 425010',
    'SQLSTATE private-value',
    'permission denied',
  ])('omits unrecognized output instead of echoing it: %s', (message) => {
    expect(supabaseReplayFailureDiagnostic(message)).toBe('');
  });

  it('prefers the bounded SQLSTATE over a broader connection category', () => {
    expect(
      supabaseReplayFailureDiagnostic('connection refused (SQLSTATE 42501)')
    ).toBe(' (diagnostic=postgres-42501)');
  });
});
