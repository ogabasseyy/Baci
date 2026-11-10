import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
  makeSenders,
  merchant,
  order,
  review,
} from './refund-alert.test-support';
import { deliverAlert, sanitizeOrderLabel } from './refund-alert-delivery';

vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');

const run = (
  senders = makeSenders(),
  extra: { order?: typeof order; review?: typeof review } = {}
) => {
  const onDelivered = vi.fn();
  const promise = deliverAlert({
    merchant,
    onDelivered,
    order,
    review,
    senders,
    ...extra,
  });
  return { onDelivered, promise };
};

describe('deliverAlert', () => {
  it('pushes and emails with the order deep link', async () => {
    const senders = makeSenders();
    const { onDelivered, promise } = run(senders);
    await expect(promise).resolves.toBe('delivered');
    expect(onDelivered).toHaveBeenCalledTimes(1);
    const [, title, body, data, channel] = vi.mocked(senders.sendPush).mock
      .calls[0];
    expect(title).toBe('Refund needs attention');
    expect(body).toContain('Refund for order #1042');
    expect(body).toContain('27,735');
    expect(data).toMatchObject({
      order_id: 'order-1',
      type: 'paystack_refund_needs_attention',
    });
    expect(channel).toBe('payments');
    const email = vi.mocked(senders.sendEmail).mock.calls[0][0];
    expect(email.to).toBe('owner@example.com');
    expect(email.textContent).toContain(
      'https://app.example.com/dashboard/orders/order-1'
    );
    expect(email.htmlContent).toContain(
      'href="https://app.example.com/dashboard/orders/order-1"'
    );
  });

  it('escapes quotes in the href', async () => {
    const senders = makeSenders();
    await run(senders, { order: { ...order, id: 'o"x' } }).promise;
    const html = vi.mocked(senders.sendEmail).mock.calls[0][0].htmlContent;
    expect(html).toContain('o%22x');
  });

  it('falls back to the root domain when the app URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    const senders = makeSenders();
    await run(senders).promise;
    expect(vi.mocked(senders.sendEmail).mock.calls[0][0].textContent).toContain(
      'https://usebaci.com/dashboard/orders/order-1'
    );
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
  });

  it('strips CR/LF and caps the order label in subject, text and push', async () => {
    const senders = makeSenders();
    const evil = `1042\r\nBcc: x@evil.test${'z'.repeat(100)}`;
    await run(senders, { order: { ...order, order_number: evil } }).promise;
    const email = vi.mocked(senders.sendEmail).mock.calls[0][0];
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeLessThan(120);
    expect(email.textContent.split('\n')[0]).not.toContain('\r');
    expect(email.textContent).not.toContain('Bcc: x@evil.test\n');
    const [, , body] = vi.mocked(senders.sendPush).mock.calls[0];
    expect(body).not.toMatch(/[\r\n]/);
  });

  it('strips all Unicode control and format characters from labels', () => {
    // C1 control, bidi override/isolate, BOM, zero-width space, LS/PS
    expect(
      sanitizeOrderLabel('A\u0085B\u202EC\u2066D\uFEFFE\u200BF\u2028G')
    ).toBe('ABCDEFG');
  });

  it('keeps the push payload order number faithful but strips metacharacters from visible copy', async () => {
    const senders = makeSenders();
    await run(senders, {
      order: { ...order, order_number: `<b>"1'&2` },
    }).promise;
    const [, , body, data] = vi.mocked(senders.sendPush).mock.calls[0];
    expect(data.order_number).toBe(`<b>"1'&2`);
    expect(body).toContain('order #b12');
    expect(body).not.toMatch(/[<>&"]/);
    // The email keeps HTML escaping for its subject/link text.
    const email = vi.mocked(senders.sendEmail).mock.calls[0][0];
    expect(email.htmlContent).toContain('Open order #&lt;b&gt;');
  });

  it('sanitizes labels and falls back to the id when empty', () => {
    expect(sanitizeOrderLabel('A\r\nB C\u0000')).toBe('ABC');
    expect(sanitizeOrderLabel('x'.repeat(100))).toHaveLength(40);
    expect(sanitizeOrderLabel('\r\n')).toBe('');
  });

  it('reports delivered as soon as email succeeds while push is slow', async () => {
    let finishPush: (v: { sent: number }) => void = () => {};
    const senders = makeSenders({
      sendPush: vi.fn(
        () =>
          new Promise<{ sent: number }>((resolve) => {
            finishPush = resolve;
          })
      ),
    });
    const { onDelivered, promise } = run(senders);
    await vi.waitFor(() => expect(onDelivered).toHaveBeenCalledTimes(1));
    finishPush({ sent: 1 });
    await expect(promise).resolves.toBe('delivered');
    expect(onDelivered).toHaveBeenCalledTimes(1);
  });

  it('classifies an unknown email outcome as uncertain', async () => {
    const senders = makeSenders({
      sendEmail: vi
        .fn()
        .mockResolvedValue({ deliveryOutcome: 'unknown', success: false }),
      sendPush: vi.fn().mockResolvedValue({ sent: 0 }),
    });
    await expect(run(senders).promise).resolves.toBe('uncertain');
  });

  it('treats a missing merchant email as skipped, not failed', async () => {
    const senders = makeSenders({
      sendPush: vi.fn().mockRejectedValue(new Error('expo down')),
    });
    const onDelivered = vi.fn();
    const outcome = await deliverAlert({
      merchant: { ...merchant, email: null },
      onDelivered,
      order,
      review,
      senders,
    });
    expect(senders.sendEmail).not.toHaveBeenCalled();
    // push really failed, so the alert stays retryable
    expect(outcome).toBe('failed');
  });

  it('is undeliverable when there is neither a push device nor an email', async () => {
    const senders = makeSenders({
      sendPush: vi.fn().mockResolvedValue({ errors: [], failed: 0, sent: 0 }),
    });
    const outcome = await deliverAlert({
      merchant: { ...merchant, email: null },
      onDelivered: vi.fn(),
      order,
      review,
      senders,
    });
    expect(outcome).toBe('undeliverable');
  });

  it('classifies an email throw as failed (documented no-dispatch boundary)', async () => {
    const senders = makeSenders({
      sendEmail: vi.fn().mockRejectedValue(new Error('no sender')),
      sendPush: vi.fn().mockResolvedValue({ sent: 0 }),
    });
    await expect(run(senders).promise).resolves.toBe('failed');
  });

  it('classifies a definite email failure and a push rejection as failed', async () => {
    const senders = makeSenders({
      sendEmail: vi.fn().mockResolvedValue({ success: false }),
      sendPush: vi.fn().mockRejectedValue(new Error('expo down')),
    });
    await expect(run(senders).promise).resolves.toBe('failed');
  });

  it.each([
    ['unknown outcome', { deliveryOutcome: 'unknown' as const, sent: 0 }],
    ['partial failure', { failed: 1, sent: 1 }],
    ['push error list', { errors: ['x'], failed: 0, sent: 1 }],
  ])('does not treat a %s push as delivered', async (_n, push) => {
    const senders = makeSenders({
      sendEmail: vi.fn().mockResolvedValue({ success: false }),
      sendPush: vi.fn().mockResolvedValue(push),
    });
    await expect(run(senders).promise).resolves.toBe('uncertain');
  });

  it('stays delivered when push is uncertain but email succeeds', async () => {
    const senders = makeSenders({
      sendPush: vi
        .fn()
        .mockResolvedValue({ deliveryOutcome: 'unknown', sent: 0 }),
    });
    await expect(run(senders).promise).resolves.toBe('delivered');
  });

  describe('copy', () => {
    const titleAndBody = async (metadata: unknown) => {
      const senders = makeSenders();
      await run(senders, { review: { ...review, metadata } }).promise;
      return vi.mocked(senders.sendPush).mock.calls[0].slice(1, 3) as [
        string,
        string,
      ];
    };

    it('says refund manually only on a definite rejection', async () => {
      const [title, body] = await titleAndBody({ ambiguous_initiation: false });
      expect(title).toBe('Refund needs attention');
      expect(body).toContain('refund manually');
    });

    it.each([
      ['ambiguous initiation', { ambiguous_initiation: true }],
      [
        'accepted provider refund id',
        { ambiguous_initiation: false, provider_refund_id: '123' },
      ],
      [
        'reference-only provider event',
        { audit_record_failed: true, reference_only_refund_event: true },
      ],
      ['missing metadata', null],
    ])('asks for a Paystack check for %s', async (_n, metadata) => {
      const [title, body] = await titleAndBody(metadata);
      expect(title).toBe('Refund needs your review');
      expect(body).toContain('check Paystack before refunding again');
      expect(body).not.toContain('refund manually');
    });
  });
});
