import { expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/zeptomail', () => ({ sendEmail: send }));

import { sendWelcomeEmail } from './email';

it('keeps the legacy welcome export inert for all callers', async () => {
  await expect(sendWelcomeEmail('owner@example.com', 'Store')).resolves.toEqual(
    {
      success: false,
      error: 'Legacy welcome sender retired',
    }
  );
  expect(send).not.toHaveBeenCalled();
});
