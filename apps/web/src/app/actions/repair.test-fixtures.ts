import type { RepairBookingInput } from '@/lib/validations/repair';

export const validRepairInput: RepairBookingInput = {
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone',
  deviceModel: 'iPhone 15',
  issueDescription: 'The screen is cracked and the battery drains quickly.',
  preferredDate: '2099-06-03',
  serviceType: 'dropoff',
};
