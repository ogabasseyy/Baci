import { describe, expect, it } from 'vitest';
import { bankListReply, MOCK_BANKS, nameEnquiryReply } from './mock-banks';
import { dataOf } from './mock-reply.test-support';

const q = (params: Record<string, string>) => new URLSearchParams(params);

describe('mock bank list and name enquiry', () => {
  it('lists the sandbox banks by name and code', () => {
    expect(dataOf(bankListReply())).toEqual(MOCK_BANKS);
    expect(MOCK_BANKS.map((bank) => bank.code)).toContain('058');
  });

  it('resolves a 10-digit account at a listed bank, and declines anything else', () => {
    expect(
      dataOf(
        nameEnquiryReply(q({ bank_code: '058', account_number: '0123456789' }))
      )
    ).toEqual({ account_name: 'SANDBOX ACCOUNT HOLDER' });
    expect(
      nameEnquiryReply(
        q({ bank_code: '9999999', account_number: '0123456789' })
      ).status
    ).toBe(400);
    expect(
      nameEnquiryReply(q({ bank_code: '058', account_number: '12345' })).status
    ).toBe(400);
  });
});
