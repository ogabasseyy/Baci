import { vi } from 'vitest';

vi.mock('@/components/ui/AppDatePickerField', () => ({
  AppDatePickerField: () => null,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'test-staff' } }),
}));

vi.mock('@/hooks/useStaffOrderFollowUps', () => ({
  useStaffOrderFollowUps: () => ({
    data: {},
    isSuccess: true,
    canWrite: false,
    refetch: vi.fn(),
    refetchWriteAccess: vi.fn(),
    resetSave: vi.fn(),
  }),
}));
