import { describe, expect, it } from 'vitest';
import { observedOxygenHostnames } from './observed-hostnames';
import { projectOxygenResponse } from './response-evidence';

describe('observed Oxygen hostnames', () => {
  it('extracts the origin stored by the recorder for a signed provider URL', () => {
    const evidence = projectOxygenResponse(
      {
        operation: 'selfie',
        httpStatus: 200,
        requestId: null,
        capture: 'parsed',
        durationMs: 1,
        body: { url: 'https://selfie.example.test/session?token=secret' },
      },
      new Set(['selfie.example.test'])
    );
    expect(observedOxygenHostnames([evidence])).toEqual([
      'selfie.example.test',
    ]);
    expect(JSON.stringify(evidence)).not.toContain('secret');
  });
  it('extracts only hosts from captured selfie and payment evidence', () => {
    const result = observedOxygenHostnames([
      {
        operation: 'selfie',
        links: { url: 'https://selfie.example.test' },
        rejectedLinks: {},
      },
      {
        operation: 'approve',
        links: {},
        rejectedLinks: {
          split_payment_link: {
            reason: 'host',
            host: 'payments.example.test',
            length: 200,
          },
        },
      },
      {
        operation: 'eligibility',
        links: { url: 'https://unrelated.example.test' },
      },
    ]);
    expect(result).toEqual(['payments.example.test', 'selfie.example.test']);
  });
  it('ignores malformed values and never returns paths, queries, or credentials', () => {
    expect(
      observedOxygenHostnames([
        {
          operation: 'approve',
          links: { url: 'https://user:secret@example.test/path?token=secret' },
          rejectedLinks: {
            url: { reason: 'host', host: 'bad/path?secret', length: 4 },
          },
        },
      ])
    ).toEqual([]);
  });
});
