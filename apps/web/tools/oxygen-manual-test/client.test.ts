// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { click, setup } from './client.test-helpers';

describe('manual test browser controls', () => {
  it('keeps a restored pending creation locked after authentication', async () => {
    const fetcher = await setup([{ code: 'authenticated' }], true);
    await click('#login');
    expect(document.querySelector<HTMLButtonElement>('#create')?.disabled).toBe(
      true
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('makes no calls on load and unlocks create only after login', async () => {
    const fetcher = await setup([{ code: 'authenticated' }]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>('#create')?.disabled).toBe(
      true
    );
    await click('#login');
    expect(document.querySelector<HTMLButtonElement>('#create')?.disabled).toBe(
      false
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps create locked after a lost local response', async () => {
    const fetcher = await setup([{ code: 'authenticated' }]);
    await click('#login');
    fetcher.mockRejectedValueOnce(new Error('lost'));
    const values: Record<string, string> = {
      first_name: 'Test',
      last_name: 'User',
      phone_number: '2348000000000',
      email: 'test@example.com',
      bvn: '00000000000',
      nin: '00000000000',
      date_of_birth: '1990-01-01',
      bank_code: '044',
      bank_name: 'Test',
      account_number: '0000000000',
      account_name: 'Test',
      salary_amount: '100',
      salary_date: '29',
    };
    for (const [name, value] of Object.entries(values)) {
      const element = document.querySelector<HTMLInputElement>(
        `[name="${name}"]`
      );
      if (element) element.value = value;
    }
    for (const element of document.querySelectorAll<HTMLInputElement>(
      '[type="checkbox"]'
    ))
      element.checked = true;
    document
      .querySelector<HTMLFormElement>('#customer')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(document.querySelector('#status')?.textContent).toContain(
        'Local response lost'
      )
    );
    expect(document.querySelector<HTMLButtonElement>('#create')?.disabled).toBe(
      true
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(sent.input.customer_personal_details.external_identifier).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
it('loads banks only on click and fills the matched name and code from the selected option', async () => {
  const fetcher = await setup([
    { code: 'authenticated' },
    {
      code: 'banks_loaded',
      banks: [
        { name: 'Access Bank', code: '044' },
        { name: 'Other Bank', code: '050' },
      ],
    },
  ]);
  await click('#login');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(document.querySelector('#load-banks')).not.toBeNull();
  await click('#load-banks');
  const select = document.querySelector<HTMLSelectElement>('#bank-select');
  expect(select).not.toBeNull();
  if (!select) throw new Error('Missing selector');
  select.value = '050';
  select.dispatchEvent(new Event('change'));
  expect(
    document.querySelector<HTMLInputElement>('[name="bank_code"]')?.value
  ).toBe('050');
  expect(
    document.querySelector<HTMLInputElement>('[name="bank_name"]')?.value
  ).toBe('Other Bank');
});
it('allows creation after a preflight login-required response and explicit reauthentication', async () => {
  const fetcher = await setup([
    { code: 'authenticated' },
    { code: 'login_required' },
    { code: 'authenticated' },
  ]);
  await click('#login');
  const form = document.querySelector<HTMLFormElement>('#customer');
  if (!form) throw new Error('Missing form');
  vi.spyOn(form, 'reportValidity').mockReturnValue(true);
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector('#status')?.textContent).toContain('expired')
  );
  await click('#login');
  expect(document.querySelector<HTMLButtonElement>('#create')?.disabled).toBe(
    false
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('fills resolved account name and clears it when account details change without logging it', async () => {
  await setup([
    { code: 'authenticated' },
    { code: 'account_name_resolved', accountName: 'Test Account' },
  ]);
  await click('#login');
  const field = (name: string) => {
    const input = document.querySelector<HTMLInputElement>(`[name=${name}]`);
    if (!input) throw new Error('Missing field');
    return input;
  };
  field('bank_code').value = '044';
  field('account_number').value = '0000000000';
  field('phone_number').value = '2348000000000';
  field('account_number').dispatchEvent(new Event('input'));
  await vi.waitFor(() =>
    expect(
      document.querySelector<HTMLInputElement>('[name=account_name]')?.value
    ).toBe('Test Account')
  );
  field('account_number').value = '1';
  const name = document.querySelector<HTMLInputElement>(
    '[name="account_name"]'
  );
  expect(name?.value).toBe('Test Account');
  expect(document.querySelector('#results')?.textContent).not.toContain(
    'Test Account'
  );
  document
    .querySelector('[name="account_number"]')
    ?.dispatchEvent(new Event('input'));
  expect(name?.value).toBe('');
});
