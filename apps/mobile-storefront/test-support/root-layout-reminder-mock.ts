import { jest } from '@jest/globals';

type ActivateDueSavingsReminder =
  typeof import('@/services/savings-reminder-notifications').activateDueSavingsReminderNotification;
type CancelScopeSavingsReminders =
  typeof import('@/services/savings-reminder-notifications').cancelScopeSavingsReminders;

export const mockActivateDueSavingsReminderNotification =
  jest.fn<ActivateDueSavingsReminder>();

export const mockCancelScopeSavingsReminders =
  jest.fn<CancelScopeSavingsReminders>();

export function mockBuildReminderScope(
  userId: string | null | undefined,
  merchantId: string | null | undefined
) {
  if (!userId || !merchantId) return null;
  return { merchantId, userId };
}
