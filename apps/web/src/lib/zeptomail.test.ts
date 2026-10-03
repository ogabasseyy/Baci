import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMailMock = vi.fn();
const sendMailWithTemplateMock = vi.fn();
const mailBatchWithTemplateMock = vi.fn();

const getZeptoMailTokenMock = vi.fn<() => string | undefined>();
const getZeptoMailFromDomainMock = vi.fn<() => string>();
const getActiveMerchantSendingDomainMock =
  vi.fn<(merchantId: string | null | undefined) => Promise<string | null>>();

const auditState = {
  inserts: [] as unknown[],
  updates: [] as Array<{ patch: Record<string, unknown>; ids: string[] }>,
  nextId: 1,
};

// The fetch-based transport replaced the zeptomail SDK; dispatch by endpoint
// so the per-method assertions below keep receiving the payload as-is.
vi.mock('@/lib/zeptomail-transport', () => ({
  ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE: 'ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN',
  zeptoMailRequest: (
    endpoint: string,
    payload: Record<string, unknown>,
    _token: string
  ) => {
    if (endpoint === 'email/template/batch') {
      return mailBatchWithTemplateMock(payload);
    }
    if (endpoint === 'email/template') {
      return sendMailWithTemplateMock(payload);
    }
    return sendMailMock(payload);
  },
}));

vi.mock('@/env', () => ({
  getZeptoMailToken: getZeptoMailTokenMock,
  getZeptoMailFromDomain: getZeptoMailFromDomainMock,
}));

vi.mock('@/lib/merchant-sending-domain', () => ({
  getActiveMerchantSendingDomain: getActiveMerchantSendingDomainMock,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn((rows: unknown) => ({
        select: vi.fn(() => {
          const insertedRows = Array.isArray(rows) ? rows : [rows];
          auditState.inserts.push(...insertedRows);
          const data = insertedRows.map(() => ({
            id: `attempt-${auditState.nextId++}`,
          }));
          return Promise.resolve({ data, error: null });
        }),
      })),
      update: vi.fn((patch: Record<string, unknown>) => ({
        in: vi.fn((_column: string, ids: string[]) => {
          auditState.updates.push({ patch, ids });
          return Promise.resolve({ error: null });
        }),
      })),
    })),
  })),
}));

describe('zeptomail audit logging', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    auditState.inserts = [];
    auditState.updates = [];
    auditState.nextId = 1;
    getZeptoMailTokenMock.mockReturnValue('test-token');
    getZeptoMailFromDomainMock.mockReturnValue('usebaci.com');
    getActiveMerchantSendingDomainMock.mockResolvedValue(null);
  });

  it('returns failure when ZEPTOMAIL_TOKEN is whitespace-only', async () => {
    getZeptoMailTokenMock.mockReturnValue(undefined);
    const { sendEmail } = await import('./zeptomail');

    const result = await sendEmail({
      to: 'customer@example.com',
      subject: 'Test',
      htmlContent: '<p>Hello</p>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ZEPTOMAIL_TOKEN/);
  });

  it('falls back to usebaci.com sender when ZEPTOMAIL_FROM_DOMAIN is whitespace-only', async () => {
    getZeptoMailFromDomainMock.mockReturnValue('usebaci.com');
    sendMailMock.mockResolvedValue({ request_id: 'domain-test' });
    const { sendEmail } = await import('./zeptomail');

    await sendEmail({
      to: 'customer@example.com',
      subject: 'Test',
      htmlContent: '<p>Hello</p>',
    });

    const callArgs = sendMailMock.mock.calls[0]?.[0];
    expect(callArgs?.from?.address).toMatch(/@usebaci\.com$/);
  });

  it('logs accepted HTML email attempts with audit context', async () => {
    sendMailMock.mockResolvedValue({ request_id: 'zepto-123' });
    const { sendEmail } = await import('./zeptomail');

    const result = await sendEmail({
      to: 'customer@example.com',
      toName: 'Customer',
      subject: 'Order Confirmation',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
      auditContext: {
        merchantId: 'merchant-1',
        orderId: 'order-1',
        customerId: 'customer-1',
        metadata: { trigger: 'order_confirmation' },
      },
    });

    expect(result).toEqual({
      success: true,
      messageId: 'zepto-123',
    });
    expect(auditState.inserts).toHaveLength(1);
    expect(auditState.inserts[0]).toMatchObject({
      transport_type: 'html',
      status: 'pending',
      email_type: 'orders',
      recipient_email: 'customer@example.com',
      subject: 'Order Confirmation',
      merchant_id: 'merchant-1',
      order_id: 'order-1',
      customer_id: 'customer-1',
      metadata: { trigger: 'order_confirmation' },
    });
    expect(auditState.updates).toHaveLength(1);
    expect(auditState.updates[0]).toMatchObject({
      ids: ['attempt-1'],
      patch: {
        status: 'accepted',
        provider_message_id: 'zepto-123',
        attempt_count: 1,
      },
    });
  });

  it('marks the dispatch boundary after audit setup and immediately before transport', async () => {
    const beforeTransportDispatch = vi.fn(() => {
      expect(auditState.inserts).toHaveLength(1);
      expect(sendMailMock).not.toHaveBeenCalled();
      return Promise.resolve();
    });
    sendMailMock.mockResolvedValue({ request_id: 'boundary-test' });
    const { sendEmail } = await import('./zeptomail');

    const result = await sendEmail({
      to: 'customer@example.com',
      subject: 'Dispatch boundary',
      htmlContent: '<p>Hello</p>',
      beforeTransportDispatch,
    });

    expect(result.success).toBe(true);
    expect(beforeTransportDispatch).toHaveBeenCalledOnce();
    expect(beforeTransportDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      sendMailMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  // Δ-64 (A1): forward `clientReference` to ZeptoMail's documented
  // `client_reference` field so the outbox helper has a server-side audit
  // trail showing which sends actually went out (used to bound the
  // residual "sent then crashed before mark-completed" duplicate window).
  it('forwards clientReference as client_reference when supplied', async () => {
    sendMailMock.mockResolvedValue({ request_id: 'zepto-cref' });
    const { sendEmail } = await import('./zeptomail');

    await sendEmail({
      to: 'customer@example.com',
      subject: 'Order Confirmation',
      htmlContent: '<p>Hello</p>',
      clientReference: 'order:abc-123:paid_email',
    });

    const callArgs = sendMailMock.mock.calls[0]?.[0];
    expect(callArgs?.client_reference).toBe('order:abc-123:paid_email');
  });

  it('omits client_reference when no clientReference is supplied', async () => {
    sendMailMock.mockResolvedValue({ request_id: 'zepto-no-cref' });
    const { sendEmail } = await import('./zeptomail');

    await sendEmail({
      to: 'customer@example.com',
      subject: 'Test',
      htmlContent: '<p>Hello</p>',
    });

    const callArgs = sendMailMock.mock.calls[0]?.[0];
    expect(callArgs).not.toHaveProperty('client_reference');
  });

  it('forwards HTML email attachments when supplied', async () => {
    sendMailMock.mockResolvedValue({ request_id: 'zepto-attachment' });
    const { sendEmail } = await import('./zeptomail');

    await sendEmail({
      to: 'customer@example.com',
      subject: 'Invoice',
      htmlContent: '<p>Attached</p>',
      attachments: [
        {
          name: 'invoice-123.pdf',
          content: 'base64-pdf',
          mime_type: 'application/pdf',
        },
      ],
    });

    const callArgs = sendMailMock.mock.calls[0]?.[0];
    expect(callArgs?.attachments).toEqual([
      {
        name: 'invoice-123.pdf',
        content: 'base64-pdf',
        mime_type: 'application/pdf',
      },
    ]);
  });

  it('omits attachments when none are supplied', async () => {
    sendMailMock.mockResolvedValue({ request_id: 'zepto-no-attachments' });
    const { sendEmail } = await import('./zeptomail');

    await sendEmail({
      to: 'customer@example.com',
      subject: 'No attachment',
      htmlContent: '<p>No attachment</p>',
    });
    await sendEmail({
      to: 'customer@example.com',
      subject: 'Empty attachments',
      htmlContent: '<p>No attachment</p>',
      attachments: [],
    });

    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock.mock.calls[0]?.[0]).not.toHaveProperty('attachments');
    expect(sendMailMock.mock.calls[1]?.[0]).not.toHaveProperty('attachments');
  });

  it('rejects missing runtime recipients without writing invalid audit rows', async () => {
    const { sendEmail } = await import('./zeptomail');

    const result = await sendEmail({
      to: null as unknown as string,
      subject: 'Broken',
      htmlContent: '<p>Hi</p>',
    });

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid email address');
    expect(auditState.inserts).toHaveLength(0);
    expect(auditState.updates).toHaveLength(0);
  });

  it('logs invalid recipient validation failures without calling the provider', async () => {
    const { sendEmail } = await import('./zeptomail');

    const result = await sendEmail({
      to: 'bad email',
      subject: 'Broken',
      htmlContent: '<p>Hi</p>',
    });

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(auditState.inserts).toHaveLength(1);
    expect(auditState.inserts[0]).toMatchObject({
      status: 'failed',
      transport_type: 'html',
      recipient_email: 'bad email',
      provider_error_message: 'Invalid email address: bad email',
    });
    expect(auditState.updates).toHaveLength(0);
  });

  it('records failed status after all retries are exhausted', async () => {
    vi.useFakeTimers();
    const beforeTransportDispatch = vi.fn().mockResolvedValue(undefined);
    const resetTransportDispatch = vi.fn().mockResolvedValue(undefined);
    const retryableError = {
      error: { message: 'Server overloaded', code: 'TM_5001', details: null },
    };
    sendMailMock.mockRejectedValue(retryableError);
    const { sendEmail } = await import('./zeptomail');

    const resultPromise = sendEmail({
      to: 'customer@example.com',
      toName: 'Customer',
      subject: 'Retry Test',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
      beforeTransportDispatch,
      resetTransportDispatch,
      auditContext: {
        merchantId: 'merchant-1',
        orderId: 'order-1',
      },
    });

    // Advance through all retry delays (1s, 2s, 4s)
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(5000);
    }

    const result = await resultPromise;
    vi.useRealTimers();

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TM_5001');
    // 1 initial + 3 retries = 4 calls
    expect(sendMailMock).toHaveBeenCalledTimes(4);
    expect(beforeTransportDispatch).toHaveBeenCalledTimes(4);
    expect(resetTransportDispatch).toHaveBeenCalledTimes(3);
    expect(auditState.inserts).toHaveLength(1);
    expect(auditState.inserts[0]).toMatchObject({
      status: 'pending',
      transport_type: 'html',
    });
    expect(auditState.updates).toHaveLength(1);
    expect(auditState.updates[0]).toMatchObject({
      ids: ['attempt-1'],
      patch: {
        status: 'failed',
        attempt_count: 4,
        provider_error_code: 'TM_5001',
        provider_error_message: 'Server overloaded',
      },
    });
  });

  it('marks transport failures as having an unknown delivery outcome', async () => {
    const transportError = Object.assign(new Error('socket closed'), {
      code: 'ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN',
    });
    sendMailMock.mockRejectedValueOnce(transportError);
    const { sendEmail } = await import('./zeptomail');

    const result = await sendEmail({
      to: 'customer@example.com',
      subject: 'Delivery outcome test',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
    });

    expect(result).toMatchObject({
      success: false,
      deliveryOutcome: 'unknown',
      error: 'socket closed',
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('rejects missing runtime batch recipients without writing invalid audit rows', async () => {
    const { sendBatchEmailWithTemplate } = await import('./zeptomail');

    const result = await sendBatchEmailWithTemplate({
      templateKey: 'newsletter-template',
      recipients: [
        {
          to: null as unknown as string,
          toName: 'Missing',
          mergeInfo: { name: 'Missing' },
        },
      ],
    });

    expect(mailBatchWithTemplateMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid email address');
    expect(auditState.inserts).toHaveLength(0);
    expect(auditState.updates).toHaveLength(0);
  });

  it('logs one batch attempt row per recipient', async () => {
    mailBatchWithTemplateMock.mockResolvedValue({ request_id: 'batch-789' });
    const { sendBatchEmailWithTemplate } = await import('./zeptomail');

    const result = await sendBatchEmailWithTemplate({
      templateKey: 'newsletter-template',
      emailType: 'newsletter',
      recipients: [
        {
          to: 'first@example.com',
          toName: 'First',
          mergeInfo: { name: 'First' },
        },
        {
          to: 'second@example.com',
          toName: 'Second',
          mergeInfo: { name: 'Second' },
        },
      ],
      auditContext: {
        merchantId: 'merchant-1',
        metadata: { campaign: 'weekly_digest' },
      },
    });

    expect(result).toEqual({
      success: true,
      messageId: 'batch-789',
    });
    expect(auditState.inserts).toHaveLength(2);
    expect(auditState.inserts[0]).toMatchObject({
      transport_type: 'batch_template',
      recipient_email: 'first@example.com',
      template_key: 'newsletter-template',
      merchant_id: 'merchant-1',
      metadata: { campaign: 'weekly_digest', mergeInfoKeys: ['name'] },
    });
    expect(auditState.inserts[1]).toMatchObject({
      transport_type: 'batch_template',
      recipient_email: 'second@example.com',
      template_key: 'newsletter-template',
      merchant_id: 'merchant-1',
      metadata: { campaign: 'weekly_digest', mergeInfoKeys: ['name'] },
    });
    expect(auditState.updates).toHaveLength(1);
    expect(auditState.updates[0]).toMatchObject({
      ids: ['attempt-1', 'attempt-2'],
      patch: {
        status: 'accepted',
        provider_message_id: 'batch-789',
        attempt_count: 1,
      },
    });
  });

  it('sends order mail from the merchant custom domain when verified+enabled', async () => {
    getActiveMerchantSendingDomainMock.mockResolvedValue('ogabassey.com');
    sendMailMock.mockResolvedValue({ request_id: 'zepto-custom' });
    const { sendEmail } = await import('./zeptomail');

    await sendEmail({
      to: 'customer@example.com',
      subject: 'Order Confirmation',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
      auditContext: { merchantId: 'merchant-1', orderId: 'order-1' },
    });

    expect(getActiveMerchantSendingDomainMock).toHaveBeenCalledWith(
      'merchant-1'
    );
    const callArgs = sendMailMock.mock.calls[0]?.[0];
    expect(callArgs?.from?.address).toBe('orders@ogabassey.com');
    // Audit row records the actual From address that went out.
    expect(auditState.inserts[0]).toMatchObject({
      from_address: 'orders@ogabassey.com',
    });
  });

  it('fails open to the platform sender when the provider rejects the custom domain', async () => {
    getActiveMerchantSendingDomainMock.mockResolvedValue('ogabassey.com');
    // Non-retryable rejection for the custom sender; success for the platform one.
    sendMailMock.mockImplementation((args: { from?: { address?: string } }) => {
      if (args.from?.address === 'orders@ogabassey.com') {
        return Promise.reject({
          error: { code: 'TM_3201', message: 'Invalid sender domain' },
        });
      }
      return Promise.resolve({ request_id: 'zepto-fellback' });
    });
    const { sendEmail } = await import('./zeptomail');
    const beforeTransportDispatch = vi.fn().mockResolvedValue(undefined);
    const resetTransportDispatch = vi.fn().mockResolvedValue(undefined);

    const result = await sendEmail({
      to: 'customer@example.com',
      subject: 'Order Confirmation',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
      auditContext: { merchantId: 'merchant-1', orderId: 'order-1' },
      beforeTransportDispatch,
      resetTransportDispatch,
    });

    expect(result).toEqual({ success: true, messageId: 'zepto-fellback' });
    expect(resetTransportDispatch).toHaveBeenCalledOnce();
    expect(beforeTransportDispatch).toHaveBeenCalledTimes(2);
    // Both senders were attempted: custom first, then platform fallback.
    expect(sendMailMock.mock.calls.map((c) => c[0]?.from?.address)).toEqual([
      'orders@ogabassey.com',
      'orders@usebaci.com',
    ]);
    // Audit records the address that actually delivered, and the attempt count
    // reflects actual sends (1 primary + 1 fallback = 2), not an inflated 5.
    expect(auditState.updates.at(-1)).toMatchObject({
      patch: {
        status: 'accepted',
        from_address: 'orders@usebaci.com',
        attempt_count: 2,
      },
    });
  });

  it('does not try a platform fallback after an ambiguous custom-domain send', async () => {
    getActiveMerchantSendingDomainMock.mockResolvedValue('ogabassey.com');
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error('socket closed after request write'), {
        code: 'ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN',
      })
    );
    const { sendEmail } = await import('./zeptomail');
    const resetTransportDispatch = vi.fn().mockResolvedValue(undefined);

    const result = await sendEmail({
      to: 'customer@example.com',
      subject: 'Order Confirmation',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
      auditContext: { merchantId: 'merchant-1', orderId: 'order-1' },
      resetTransportDispatch,
    });

    expect(result).toMatchObject({
      success: false,
      deliveryOutcome: 'unknown',
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(resetTransportDispatch).not.toHaveBeenCalled();
    expect(sendMailMock.mock.calls[0]?.[0]?.from?.address).toBe(
      'orders@ogabassey.com'
    );
  });

  it('falls back to the platform domain for order mail without a custom domain', async () => {
    getActiveMerchantSendingDomainMock.mockResolvedValue(null);
    sendMailMock.mockResolvedValue({ request_id: 'zepto-fallback' });
    const { sendEmail } = await import('./zeptomail');

    await sendEmail({
      to: 'customer@example.com',
      subject: 'Order Confirmation',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
      auditContext: { merchantId: 'merchant-2', orderId: 'order-2' },
    });

    const callArgs = sendMailMock.mock.calls[0]?.[0];
    expect(callArgs?.from?.address).toBe('orders@usebaci.com');
  });

  it('keeps platform→merchant noreply mail on the platform domain even with a custom domain', async () => {
    getActiveMerchantSendingDomainMock.mockResolvedValue('ogabassey.com');
    sendMailMock.mockResolvedValue({ request_id: 'zepto-noreply' });
    const { sendEmail } = await import('./zeptomail');

    await sendEmail({
      to: 'merchant@example.com',
      subject: 'Settlement processed',
      htmlContent: '<p>Paid</p>',
      emailType: 'noreply',
      auditContext: { merchantId: 'merchant-1' },
    });

    // noreply is not a customer-facing type, so resolution is skipped entirely.
    expect(getActiveMerchantSendingDomainMock).not.toHaveBeenCalled();
    const callArgs = sendMailMock.mock.calls[0]?.[0];
    expect(callArgs?.from?.address).toBe('noreply@usebaci.com');
  });

  it('prefers an explicit merchantId over auditContext for the sending domain', async () => {
    getActiveMerchantSendingDomainMock.mockResolvedValue('ogabassey.com');
    sendMailMock.mockResolvedValue({ request_id: 'zepto-explicit' });
    const { sendEmail } = await import('./zeptomail');

    await sendEmail({
      to: 'customer@example.com',
      subject: 'Order Confirmation',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
      merchantId: 'explicit-merchant',
      auditContext: { merchantId: 'audit-merchant' },
    });

    expect(getActiveMerchantSendingDomainMock).toHaveBeenCalledWith(
      'explicit-merchant'
    );
  });
});
