const REFUSALS: Record<string, string> = {
  ops_approval_not_an_approver:
    'This login is not an approver login. Use your own approver login, which must hold the approver role and no other role.',
  ops_approval_requester_cannot_approve:
    'You, or another of your logins, opened this request, so you cannot decide it. Two other people must.',
  ops_approval_unregistered_login:
    'This login has not been registered to a person. Ask the owner to record it before you decide requests.',
  ops_approval_already_decided: 'You have already decided this request.',
  ops_approval_closed:
    'This request is already closed (rejected, used or replaced).',
  ops_approval_expired:
    'This request has expired. Ask for a new request to be opened.',
  ops_approval_missing: 'This request does not exist.',
  ops_approval_confirmation_mismatch:
    'The request changed since it was listed. List again and re-check it.',
  ops_approval_invalid_decision: 'The decision must be approve or reject.',
};

export function refusalMessage(code: string): string {
  return (
    REFUSALS[code] ??
    'The database refused this decision. Nothing was recorded.'
  );
}
