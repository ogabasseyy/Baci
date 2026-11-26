import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { binding } from './merchant-inbox-client.test-support';
import { updateMerchantInboxConversation } from './merchant-inbox-manage-client';
import {
  chatWithLabels,
  NOW,
} from './merchant-inbox-manage-client.test-support';

afterEach(() => vi.unstubAllGlobals());

const update = { followUpAt: '2026-11-23T08:00:00.000Z' };
const change = (extra: { priority?: 'high' } = {}) =>
  updateMerchantInboxConversation(binding, {
    conversationId: 7,
    update: { ...update, ...extra },
    now: NOW,
  });

describe('bugfix: a failed change says whether the snooze was sent', () => {
  it.each([
    ['gets no clear answer', {}],
    ['cannot be checked afterwards', { readsDownAfterFailure: true }],
  ])('marks it unconfirmed when the snooze %s', async (_name, options) => {
    chatWithLabels([], '/toggle_status', options);

    await expect(change()).resolves.toMatchObject({
      ok: false,
      code: 'unavailable',
      followUpSent: { state: 'unconfirmed', customerName: expect.any(String) },
    });
  });

  it('marks it applied when a later write fails', async () => {
    chatWithLabels([], '/toggle_priority');

    await expect(change({ priority: 'high' })).resolves.toMatchObject({
      ok: false,
      followUpSent: { state: 'applied' },
    });
  });

  it.each([
    ['the label cannot be saved', '/labels', {}],
    ['the engine refuses the snooze', '/toggle_status', { failStatus: 422 }],
  ])('says nothing was sent when %s', async (_name, failing, options) => {
    chatWithLabels([], failing, options);

    await expect(change()).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});
