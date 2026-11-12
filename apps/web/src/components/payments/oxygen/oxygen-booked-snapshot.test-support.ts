import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';

export const oxygenBookedSnapshot = oxygenRuntimeSnapshotSchema.parse({
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'booked',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    bookingReference: '70000000-0000-4000-8000-000000000001',
    booking: {
      loan_reference: '70000000-0000-4000-8000-000000000001',
      status: 'BOOKED',
      product_amount: 100000,
      equity_percentage: 25,
      equity_amount: 25000,
      loan_amount: 75000,
      loan_tenure: 3,
    },
  },
});
