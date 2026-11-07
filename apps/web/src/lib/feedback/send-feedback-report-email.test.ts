import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSendEmail } = vi.hoisted(() => ({ mockSendEmail: vi.fn() }));

vi.mock('@/lib/zeptomail', () => ({ sendEmail: mockSendEmail }));

import type { FeedbackReportEmailInput } from './feedback-report-email';
import {
  FEEDBACK_EMAIL_BUDGET_MS,
  sendFeedbackReportEmail,
} from './send-feedback-report-email';

function input(
  overrides: Partial<FeedbackReportEmailInput> = {}
): FeedbackReportEmailInput {
  return {
    report: { message: 'Orders list is empty', screen: '/orders' },
    feedbackId: 'fb-1',
    businessName: 'Ogabassey',
    merchantSlug: 'ogabassey',
    senderEmail: 'owner@example.com',
    submittedAt: new Date('2026-10-30T12:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  mockSendEmail.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('sendFeedbackReportEmail', () => {
  it('emails the support inbox with the sender as reply-to', async () => {
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'm-1' });

    await expect(sendFeedbackReportEmail(input())).resolves.toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'support@usebaci.com',
        replyTo: 'owner@example.com',
        subject: 'Feedback from Ogabassey: Orders list is empty',
        emailType: 'notifications',
        redactProviderErrorLog: true,
      })
    );
  });

  it('bounds delivery to one attempt within the client request budget', async () => {
    mockSendEmail.mockResolvedValue({ success: true });
    const before = Date.now();

    await sendFeedbackReportEmail(input());

    const params = mockSendEmail.mock.calls[0]?.[0];
    expect(FEEDBACK_EMAIL_BUDGET_MS).toBeLessThan(20_000);
    expect(params.maxAttemptsPerSender).toBe(1);
    expect(params.signal).toBeInstanceOf(AbortSignal);
    expect(params.fallbackDeadlineMs).toBeGreaterThanOrEqual(
      before + FEEDBACK_EMAIL_BUDGET_MS
    );
    expect(params.fallbackDeadlineMs).toBeLessThanOrEqual(
      Date.now() + FEEDBACK_EMAIL_BUDGET_MS
    );
  });

  it('reports not-emailed when the provider times out', async () => {
    mockSendEmail.mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError')
    );

    await expect(sendFeedbackReportEmail(input())).resolves.toBe(false);
  });

  it('omits reply-to when the sender has no email', async () => {
    mockSendEmail.mockResolvedValue({ success: true });

    await sendFeedbackReportEmail(input({ senderEmail: null }));

    expect(mockSendEmail.mock.calls[0]?.[0]?.replyTo).toBeUndefined();
  });

  it('returns false when the provider rejects the email', async () => {
    mockSendEmail.mockResolvedValue({ success: false, errorCode: 'TM_3201' });

    await expect(sendFeedbackReportEmail(input())).resolves.toBe(false);
  });

  it('returns false instead of throwing when sending throws', async () => {
    mockSendEmail.mockRejectedValue(new Error('ZEPTOMAIL_TOKEN missing'));

    await expect(sendFeedbackReportEmail(input())).resolves.toBe(false);
  });
});
