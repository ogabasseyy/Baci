import { describe, expect, it, vi } from 'vitest';
import { sendSyntheticMessage } from './send-synthetic-message.mjs';

describe('sendSyntheticMessage', () => {
  it('fills the composer, waits for delivery, and returns the generated message', async () => {
    const fill = vi.fn().mockResolvedValue(undefined);
    const press = vi.fn().mockResolvedValue(undefined);
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const count = vi.fn(async () => 1);
    const widgetFrame = {
      getByPlaceholder: vi.fn(() => ({ waitFor, fill, press })),
      getByText: vi.fn(() => ({ waitFor, count })),
    };
    const page = {
      waitForResponse: vi.fn((predicate) =>
        Promise.resolve(
          (() => {
            const matched = predicate({
              url: () => 'https://localhost:43129/api/v1/widget/messages',
              request: () => ({ method: () => 'POST' }),
            });
            expect(matched).toBe(true);
            return { ok: () => true };
          })()
        )
      ),
    };

    const msg = await sendSyntheticMessage(page, widgetFrame);

    expect(msg).toMatch(/^BACI-SYNTHETIC-TENANT-A-ONLY-/);
    expect(fill).toHaveBeenCalledWith(msg);
    expect(press).toHaveBeenCalledWith('Enter');
  });
});
