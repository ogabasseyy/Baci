import { describe, expect, it } from 'vitest';
import { refusalMessage } from './refusal-message';

describe('refusalMessage', () => {
  it('explains known refusals in plain words', () => {
    expect(refusalMessage('ops_approval_requester_cannot_approve')).toMatch(
      /opened this request/
    );
    expect(refusalMessage('ops_approval_not_an_approver')).toMatch(
      /approver login/
    );
    expect(refusalMessage('ops_approval_unregistered_login')).toMatch(
      /not been registered to a person/
    );
    expect(refusalMessage('ops_approval_requester_cannot_approve')).toMatch(
      /or another of your logins/
    );
  });

  it('falls back to a generic message', () => {
    expect(refusalMessage('something_else')).toBe(
      'The database refused this decision. Nothing was recorded.'
    );
  });
});
