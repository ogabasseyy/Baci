// @vitest-environment jsdom

import { expect, it, vi } from 'vitest';
import { click, setup } from './client.test-helpers';
import { renderProbeUi } from './ui';

it('queues the changed account lookup while a prior enquiry is pending and ignores its stale name', async () => {
  const fetcher = await setup([{ code: 'authenticated' }]);
  await click('#login');
  const field = (name: string) => {
    const input = document.querySelector<HTMLInputElement>(`[name=${name}]`);
    if (!input) throw new Error('Missing input');
    return input;
  };
  let finish: ((response: Response) => void) | undefined;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        code: 'account_name_resolved',
        accountName: 'Current Account',
      })
    )
  );
  field('bank_code').value = '044';
  field('phone_number').value = '2348000000000';
  field('account_number').value = '0000000000';
  field('account_number').dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  field('account_number').value = '1111111111';
  field('account_number').dispatchEvent(new Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (!finish) throw new Error('Missing pending lookup');
  finish(
    new Response(
      JSON.stringify({
        code: 'account_name_resolved',
        accountName: 'Stale Account',
      })
    )
  );
  await vi.waitFor(() =>
    expect(field('account_name').value).toBe('Current Account')
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('autosaves input fields across reload without OTP, consent or automatic provider calls', async () => {
  sessionStorage.clear();
  const fetcher = await setup([]);
  const input = document.querySelector<HTMLInputElement>('[name=bvn]');
  if (!input) throw new Error('Missing input');
  input.value = '00000000000';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(localStorage.length).toBeGreaterThan(0);
  document
    .querySelector<HTMLInputElement>('#otp')
    ?.setAttribute('value', '123456');
  const consent = document.querySelector<HTMLInputElement>('[name=terms]');
  if (consent) consent.checked = true;
  vi.resetModules();
  await setup([]);
  expect(document.querySelector<HTMLInputElement>('[name=bvn]')?.value).toBe(
    '00000000000'
  );
  expect(
    document.querySelector<HTMLInputElement>('[name=terms]')?.checked
  ).toBe(false);
  expect(document.querySelector<HTMLInputElement>('#otp')?.value).toBe('');
  expect(fetcher).not.toHaveBeenCalled();
  sessionStorage.clear();
});
it('expires saved input after 24 hours', async () => {
  sessionStorage.clear();
  await setup([]);
  const input = document.querySelector<HTMLInputElement>('[name=first_name]');
  if (!input) throw new Error('Missing input');
  input.value = 'Fixture';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 25 * 60 * 60 * 1000);
  vi.resetModules();
  await setup([]);
  expect(
    document.querySelector<HTMLInputElement>('[name=first_name]')?.value
  ).toBe('');
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it('prepares a user-acknowledged retry without submitting a new loan request', async () => {
  sessionStorage.setItem(
    'oxygen-manual-draft:PRODUCTION:create-lock',
    'locked'
  );
  const fetcher = await setup([
    { code: 'authenticated' },
    { code: 'retry_acknowledgement_required' },
    { code: 'retry_ready' },
  ]);
  await click('#login');
  await click('#prepare-retry');
  expect(document.querySelector<HTMLButtonElement>('#create')?.disabled).toBe(
    true
  );
  const ack = document.querySelector<HTMLInputElement>('#retry-ack');
  if (!ack) throw new Error('Missing acknowledgement');
  ack.checked = true;
  await click('#prepare-retry');
  expect(document.querySelector<HTMLButtonElement>('#create')?.disabled).toBe(
    false
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  for (const call of fetcher.mock.calls)
    expect(JSON.parse(String(call[1]?.body)).action).not.toBe('create');
});
it('resumes the active new-customer request without enabling create or the wrong validation branch', async () => {
  document.documentElement.innerHTML = renderProbeUi({
    origin: 'http://127.0.0.1:3417',
    csrf: 'test',
    environment: 'production',
    configured: true,
    requestCreated: true,
    customerPath: 'new',
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ code: 'authenticated' })));
  vi.stubGlobal('fetch', fetcher);
  await import('./client.js');
  await click('#login');
  expect(document.querySelector<HTMLButtonElement>('#create')?.disabled).toBe(
    true
  );
  expect(
    document.querySelector<HTMLButtonElement>(
      '[data-action="validate-existing"]'
    )?.disabled
  ).toBe(true);
  expect(
    document.querySelector<HTMLButtonElement>('[data-action="validate-new"]')
      ?.disabled
  ).toBe(false);
  expect(
    document.querySelector<HTMLButtonElement>('[data-action="resend-otp"]')
      ?.disabled
  ).toBe(false);
  expect(
    document.querySelector<HTMLButtonElement>('#prepare-retry')?.disabled
  ).toBe(true);
  expect(document.querySelector<HTMLFormElement>('#customer')?.hidden).toBe(
    true
  );
  expect(document.querySelector('#recovery-status')?.textContent).toContain(
    'current request'
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
