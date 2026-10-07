import { activateDueSavingsReminderSafely } from './activate-savings-reminder-safely';

const mockActivate = jest.fn();
const mockRecord = jest.fn();
jest.mock('./savings-reminder-notifications', () => ({
  activateDueSavingsReminderNotification: () => mockActivate(),
}));
jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: (...args: unknown[]) => mockRecord(...args),
}));
beforeEach(() => jest.clearAllMocks());
it('catches activation errors without including private error messages', async () => {
  mockActivate.mockRejectedValue(new Error('private storage details'));
  await expect(activateDueSavingsReminderSafely()).resolves.toBeUndefined();
  expect(mockRecord).toHaveBeenCalledWith(
    'root_layout:savings_reminder_activation_failed'
  );
});
it('activates successfully without recording an error', async () => {
  mockActivate.mockResolvedValue(null);
  await activateDueSavingsReminderSafely();
  expect(mockRecord).not.toHaveBeenCalled();
});
