import { expect, it } from 'vitest';
import { supabaseCommandDiagnostic } from './supabase-command-diagnostic';

it.each([
  ['Cannot connect to the Docker daemon', 'docker-unavailable'],
  ['Bind failed: address already in use', 'port-conflict'],
  ['failed to pull image', 'image-pull'],
  ['no space left on device', 'disk-full'],
  ['failed to parse config', 'invalid-config'],
  ['connection refused', 'connection-refused'],
])('classifies %s without retaining subprocess secrets', (message, category) => {
  expect(
    supabaseCommandDiagnostic(`${message} postgresql://user:secret@host/db`)
  ).toBe(` (reason=${category})`);
});
it('reports only the SQLSTATE and discards unknown output', () => {
  expect(
    supabaseCommandDiagnostic(
      'private SQL failed (SQLSTATE 42P01) token=secret'
    )
  ).toBe(' (sqlstate=42P01)');
  expect(supabaseCommandDiagnostic('token=secret unrecognized failure')).toBe(
    ''
  );
});
