import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSendEmail } = vi.hoisted(() => ({ mockSendEmail: vi.fn() }));

vi.mock('@/lib/zeptomail', () => ({ sendEmail: mockSendEmail }));

import type { FeedbackReportEmailInput } from './feedback-report-email';
import { sendFeedbackReportEmail } from './send-feedback-report-email';

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
      })
    );
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
