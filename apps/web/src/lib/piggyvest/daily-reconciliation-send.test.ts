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

  it('regression: a paging side check prefixes the subject so an all-clear report never reads all clear', () => {
    const clear = {
      subject: 'PiggyVest daily reconciliation: all clear (2026-11-21)',
      text: 'body',
      html: '<h2>S</h2>',
    };
    expect(withEmailLines(clear, ['x'], true).subject).toBe(
      'ATTENTION, see below: PiggyVest daily reconciliation: all clear (2026-11-21)'
    );
    expect(withEmailLines(clear, ['x']).subject).toBe(clear.subject);
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
