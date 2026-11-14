import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/zeptomail-transport', () => ({
  zeptoMailRequest: mocks.request,
}));

import { sendReconciliationEmail } from './daily-reconciliation-email';

const TOKEN = createHash('sha256').update('zeptomail-token').digest('hex');
const message = {
  to: 'owner@example.test',
  subject: 'PiggyVest daily reconciliation: all clear (2026-11-03)',
  textContent: 'text body',
  htmlContent: '<p>html body</p>',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendReconciliationEmail', () => {
  it('sends one message from the notifications sender on the configured domain', async () => {
    mocks.request.mockResolvedValue({ request_id: 'req-1' });
    const result = await sendReconciliationEmail(message, {
      ZEPTOMAIL_TOKEN: TOKEN,
      ZEPTOMAIL_FROM_DOMAIN: 'mail.example.test',
    } as unknown as NodeJS.ProcessEnv);
    expect(result).toEqual({ success: true });
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledWith(
      'email',
      {
        from: {
          address: 'notifications@mail.example.test',
          name: 'Baci Notifications',
        },
        to: [
          {
            email_address: {
              address: 'owner@example.test',
              name: 'owner@example.test',
            },
          },
        ],
        subject: message.subject,
        htmlbody: message.htmlContent,
        textbody: message.textContent,
      },
      TOKEN
    );
  });

  it('defaults the sending domain', async () => {
    mocks.request.mockResolvedValue({});
    await sendReconciliationEmail(message, {
      ZEPTOMAIL_TOKEN: TOKEN,
    } as unknown as NodeJS.ProcessEnv);
    expect(mocks.request.mock.calls[0][1].from.address).toBe(
      'notifications@usebaci.com'
    );
  });

  it.each([
    undefined,
    '',
    '   ',
  ])('does not call the provider with token %j', async (token) => {
    const result = await sendReconciliationEmail(message, {
      ZEPTOMAIL_TOKEN: token,
    } as unknown as NodeJS.ProcessEnv);
    expect(result).toEqual({ success: false });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('reports failure, once, without retrying, when the provider rejects', async () => {
    mocks.request.mockRejectedValue(new Error('HTTP 500'));
    const result = await sendReconciliationEmail(message, {
      ZEPTOMAIL_TOKEN: TOKEN,
    } as unknown as NodeJS.ProcessEnv);
    expect(result).toEqual({ success: false });
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});
