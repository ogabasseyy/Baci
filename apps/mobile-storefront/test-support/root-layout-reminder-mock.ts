import { jest } from '@jest/globals';

type ActivateDueSavingsReminder =
  typeof import('@/services/savings-reminder-notifications').activateDueSavingsReminderNotification;

export const mockActivateDueSavingsReminderNotification =
  jest.fn<ActivateDueSavingsReminder>();
