import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderProbeUi } from './ui';

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function setup(replies: unknown[], creationLocked = false) {
  document.documentElement.innerHTML = renderProbeUi({
    origin: 'http://127.0.0.1:3417',
    csrf: 'fixture',
    environment: 'production',
    configured: true,
    creationLocked,
  });
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify(replies.shift()), { status: 200 })
  );
  vi.stubGlobal('fetch', fetcher);
  await import('./client.js');
  return fetcher;
}
async function click(id: string) {
  document.querySelector<HTMLButtonElement>(id)?.click();
  await vi.waitFor(() =>
    expect(document.querySelector('#status')?.textContent).not.toBe(
      'Sending your manual request…'
    )
  );
}
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

it('retains the filled draft after successful creation without retaining OTP or consent', async () => {
  const fetcher = await setup([
    { code: 'authenticated' },
    { code: 'request_created', customerPath: 'existing' },
  ]);
  await click('#login');
  const form = document.querySelector<HTMLFormElement>('#customer');
  if (!form) throw new Error('Missing form');
  vi.spyOn(form, 'reportValidity').mockReturnValue(true);
  const bvn = form.elements.namedItem('bvn') as HTMLInputElement;
  bvn.value = '00000000000';
  bvn.dispatchEvent(new Event('input', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector('#status')?.textContent).toContain(
      'request created'
    )
  );
  const saved = JSON.parse(
    localStorage.getItem('oxygen-manual-draft:PRODUCTION') || '{}'
  );
  expect(saved.fields.bvn).toBe('00000000000');
  expect(saved.fields.otp).toBeUndefined();
  expect(saved.fields.terms).toBeUndefined();
  expect(bvn.value).toBe('00000000000');
  expect(form.hidden).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
