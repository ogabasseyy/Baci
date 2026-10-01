import { describe, expect, it } from 'vitest';
import { parseJumiaOAuthDiagnosticContext } from './oauth-diagnostic-context';

describe('parseJumiaOAuthDiagnosticContext', () => {
  it.each([
    [undefined, 'ordinary-state', { status: 'ordinary' }],
    [
      '11111111-1111-4111-8111-111111111111',
      'jumia-diagnostic-state',
      {
        diagnosticId: '11111111-1111-4111-8111-111111111111',
        status: 'diagnostic',
      },
    ],
    [undefined, 'jumia-diagnostic-state', { status: 'invalid' }],
    ['not-a-uuid', 'ordinary-state', { status: 'invalid' }],
  ])('preserves diagnostic state and marker pairing', (diagnosticId, storedState, expected) => {
    expect(
      parseJumiaOAuthDiagnosticContext({ diagnosticId, storedState })
    ).toEqual(expected);
  });
});
