import { vi } from 'vitest';
import { OxygenProbe } from './session';

export const customer = {
  accept_terms_and_condition: 'yes',
  user_category: 'individual',
  customer_personal_details: {
    external_identifier: 'test',
    first_name: 'Test',
    last_name: 'User',
    middle_name: '',
    phone_number: '2348000000000',
    email: 'test@example.com',
    bvn: '00000000000',
    nin: '00000000000',
    date_of_birth: '1990-01-01',
  },
  customer_bank_details: {
    bank_code: '044',
    bank_name: 'Test',
    account_number: '0000000000',
    account_name: 'Test User',
  },
  customer_employment_details: {
    employment_status: 'EMPLOYED',
    name_of_employer: 'Test',
    salary_amount: '100',
    salary_date: 29,
  },
};
export function setup(replies: unknown[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const reply = replies.shift();
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(
      new Response(JSON.stringify(reply), { status: 200 })
    );
  });
  return {
    calls,
    probe: new OxygenProbe(
      {
        baseUrl: 'https://api.theoxygen.com/services/partners',
        environment: 'dev',
        reference: 'partner',
        secret: 'private-secret',
      },
      fetcher
    ),
  };
}
