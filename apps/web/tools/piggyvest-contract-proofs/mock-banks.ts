import { fail, type MockReply, ok } from './mock-sandbox-types';

/**
 * GET /transfer/bank-list and /transfer/name-enquiry in the mock. A listed
 * bank code with a 10-digit account resolves to a fixed sandbox name;
 * anything else is declined, as an unresolvable destination would be.
 */

export const MOCK_BANKS: { name: string; code: string }[] = [
  { name: 'Sandbox Bank', code: '058' },
  { name: 'Sandbox Microfinance Bank', code: '090267' },
];

export function bankListReply(): MockReply {
  return ok(MOCK_BANKS, 'Banks retrieved');
}

export function nameEnquiryReply(query: URLSearchParams): MockReply {
  const listed = MOCK_BANKS.some(
    (bank) => bank.code === query.get('bank_code')
  );
  if (!listed || !/^\d{10}$/.test(query.get('account_number') ?? ''))
    return fail('Could not resolve account name');
  return ok({ account_name: 'SANDBOX ACCOUNT HOLDER' }, 'Account resolved');
}
