import { describe, expect, it } from 'vitest';
import {
  buildFeedbackReportEmail,
  type FeedbackReportEmailInput,
} from './feedback-report-email';

function input(
  overrides: Partial<FeedbackReportEmailInput> = {}
): FeedbackReportEmailInput {
  return {
    report: {
      message: 'Orders tab shows nothing\nsince this morning',
      screen: '/orders',
      platform: 'android',
      appVersion: '2.1.530',
      device: 'Pixel 9',
    },
    feedbackId: 'fb-1',
    businessName: 'Ogabassey',
    merchantSlug: 'ogabassey',
    senderEmail: 'owner@example.com',
    submittedAt: new Date('2026-10-30T12:00:00.000Z'),
    ...overrides,
  };
}

describe('buildFeedbackReportEmail', () => {
  it('uses the store name and the first line of the message as the subject', () => {
    const email = buildFeedbackReportEmail(input());

    expect(email.subject).toBe(
      'Feedback from Ogabassey: Orders tab shows nothing'
    );
  });

  it('truncates a long first line in the subject', () => {
    const email = buildFeedbackReportEmail(
      input({ report: { message: 'x'.repeat(200) } })
    );

    expect(email.subject).toBe(`Feedback from Ogabassey: ${'x'.repeat(59)}…`);
  });

  it('lists the store, sender, screen and device in the text body', () => {
    const email = buildFeedbackReportEmail(input());

    expect(email.textContent).toContain('since this morning');
    expect(email.textContent).toContain('Store: Ogabassey (ogabassey)');
    expect(email.textContent).toContain('Sent by: owner@example.com');
    expect(email.textContent).toContain('Screen: /orders');
    expect(email.textContent).toContain('App version: 2.1.530');
    expect(email.textContent).toContain('Report ID: fb-1');
  });

  it('omits detail rows that were not provided', () => {
    const email = buildFeedbackReportEmail(
      input({
        report: { message: 'Hi' },
        senderEmail: null,
        merchantSlug: null,
        businessName: null,
      })
    );

    expect(email.subject).toBe('Feedback from a merchant: Hi');
    expect(email.textContent).toContain('Store: Unnamed store');
    expect(email.textContent).not.toContain('Sent by');
    expect(email.textContent).not.toContain('Screen');
  });

  it('escapes HTML in the message and details', () => {
    const email = buildFeedbackReportEmail(
      input({
        report: { message: '<script>alert(1)</script>', screen: '<b>x</b>' },
      })
    );

    expect(email.htmlContent).not.toContain('<script>');
    expect(email.htmlContent).not.toContain('<b>x</b>');
    expect(email.htmlContent).toContain('&lt;script&gt;');
  });

  it('offers reply instructions only when the sender email is known', () => {
    expect(buildFeedbackReportEmail(input()).htmlContent).toContain(
      'Reply to this email'
    );
    expect(
      buildFeedbackReportEmail(input({ senderEmail: null })).htmlContent
    ).not.toContain('Reply to this email');
  });
});
