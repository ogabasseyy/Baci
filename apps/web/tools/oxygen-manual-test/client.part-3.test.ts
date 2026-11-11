// @vitest-environment jsdom

import { expect, it, vi } from 'vitest';
import { click, setup } from './client.test-helpers';

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
