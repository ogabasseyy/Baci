import { expect, it } from 'vitest';
import {
  oxygenRuntimeActionSchema,
  validateOxygenFile,
} from './oxygen-runtime';

it('accepts decimal equity within 25 to 90 and rejects out-of-contract plans', () => {
  expect(
    oxygenRuntimeActionSchema.safeParse({
      action: 'book',
      equityPercentage: 35.25,
      tenure: 3,
    }).success
  ).toBe(true);
  expect(
    oxygenRuntimeActionSchema.safeParse({
      action: 'book',
      equityPercentage: 91,
      tenure: 3,
    }).success
  ).toBe(false);
  expect(
    oxygenRuntimeActionSchema.safeParse({ action: 'activate' }).success
  ).toBe(false);
});
it('checks actual file bytes as well as MIME and filename', () => {
  expect(
    validateOxygenFile(
      new Uint8Array([37, 80, 68, 70, 45]),
      'application/pdf',
      'bill.pdf'
    )
  ).toBe(true);
  expect(
    validateOxygenFile(
      new Uint8Array([255, 216, 255, 224]),
      'image/jpeg',
      'bill.jpg'
    )
  ).toBe(true);
  expect(
    validateOxygenFile(
      new Uint8Array([60, 104, 116, 109, 108]),
      'image/jpeg',
      'bill.jpg'
    )
  ).toBe(false);
  expect(
    validateOxygenFile(
      new Uint8Array([37, 80, 68, 70, 45]),
      'application/pdf',
      '../bill.pdf'
    )
  ).toBe(false);
});

it('accepts production provider contexts but rejects caller-selected runtime environments', async () => {
  const { oxygenProviderContextSchema, oxygenRuntimeSubmissionSchema } =
    await import('./oxygen-runtime');
  const context = {
    workflowId: '60000000-0000-4000-8000-000000000001',
    stage: 'application_required',
    version: 0,
    environment: 'production',
    partnerReference: 'partner',
    merchantReference: null,
    orderId: '60000000-0000-4000-8000-000000000002',
    productAmount: 100,
    orderPhone: '',
    productName: 'Order',
    state: {},
  };
  expect(oxygenProviderContextSchema.safeParse(context).success).toBe(true);
  expect(
    oxygenProviderContextSchema.safeParse({ ...context, environment: 'other' })
      .success
  ).toBe(false);
  expect(
    oxygenRuntimeSubmissionSchema.safeParse({
      workflowId: context.workflowId,
      version: 0,
      idempotencyKey: context.orderId,
      command: { action: 'refresh_kyc' },
      environment: 'production',
    }).success
  ).toBe(false);
});
