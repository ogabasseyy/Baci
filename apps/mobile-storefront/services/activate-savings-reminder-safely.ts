import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { activateDueSavingsReminderNotification } from './savings-reminder-notifications';

export async function activateDueSavingsReminderSafely(): Promise<void> {
  try {
    await activateDueSavingsReminderNotification();
  } catch {
    recordCrashBreadcrumb('root_layout:savings_reminder_activation_failed');
  }
}
