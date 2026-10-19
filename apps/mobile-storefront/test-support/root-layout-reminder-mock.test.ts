import { beforeEach, expect, it } from '@jest/globals';
import { mockActivateDueSavingsReminderNotification } from './root-layout-reminder-mock';

beforeEach(() => {
  mockActivateDueSavingsReminderNotification.mockReset();
});

it('supports both idle and scheduled reminder results with the service promise contract', async () => {
  mockActivateDueSavingsReminderNotification
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce('scheduled-reminder');

  await expect(
    mockActivateDueSavingsReminderNotification()
  ).resolves.toBeNull();
  await expect(mockActivateDueSavingsReminderNotification()).resolves.toBe(
    'scheduled-reminder'
  );
});

it('supports activation rejection used by the layout error-handling regression', async () => {
  mockActivateDueSavingsReminderNotification.mockRejectedValueOnce(
    new Error('storage unavailable')
  );

  await expect(mockActivateDueSavingsReminderNotification()).rejects.toThrow(
    'storage unavailable'
  );
});
