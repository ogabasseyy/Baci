import { describe, expect, it, vi } from 'vitest';
import {
  deliverReconciliationEmail,
  withEmailLines,
} from './daily-reconciliation-send';

vi.mock('server-only', () => ({}));

const email = { subject: 'S', text: 'body', html: '<h2>S</h2>' };

describe('withEmailLines', () => {
  it('appends escaped lines to text and html', () => {
    const out = withEmailLines(email, ['a <b>']);
    expect(out.text).toBe('body\n\na <b>');
    expect(out.html).toBe('<h2>S</h2><p>a &lt;b&gt;</p>');
  });

  it('leaves the email unchanged with no lines', () => {
    expect(withEmailLines(email, [])).toBe(email);
  });
});

describe('deliverReconciliationEmail', () => {
  it('sends to a valid address and reports success', async () => {
    const sendEmail = vi.fn(async () => ({ success: true }));
    await expect(
      deliverReconciliationEmail({
        address: 'owner@example.com',
        email,
        sendEmail,
      })
    ).resolves.toBe(true);
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'owner@example.com',
      subject: 'S',
      textContent: 'body',
      htmlContent: '<h2>S</h2>',
    });
  });

  it('reports false without an address, on failure and on a throw', async () => {
    const sendEmail = vi.fn(async () => ({ success: false }));
    await expect(
      deliverReconciliationEmail({ address: undefined, email, sendEmail })
    ).resolves.toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    await expect(
      deliverReconciliationEmail({
        address: 'owner@example.com',
        email,
        sendEmail,
      })
    ).resolves.toBe(false);
    await expect(
      deliverReconciliationEmail({
        address: 'owner@example.com',
        email,
        sendEmail: vi.fn(async () => Promise.reject(new Error('down'))),
      })
    ).resolves.toBe(false);
  });
});
