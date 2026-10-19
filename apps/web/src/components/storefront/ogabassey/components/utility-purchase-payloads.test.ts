import { describe, expect, it } from 'vitest';
import {
  buildAirtimeDataPayload,
  buildBillPayload,
} from './utility-purchase-payloads';

describe('buildAirtimeDataPayload', () => {
  it('signs the canonical airtime payload from the tab draft', () => {
    expect(
      buildAirtimeDataPayload(
        {
          amount: 1000,
          dataPlanCode: 'DATA-1GB',
          networkProvider: 'MTN',
          phoneNumber: '08012345678',
        },
        'airtime'
      )
    ).toEqual({
      amount: 1000,
      dataPlanCode: 'DATA-1GB',
      networkProvider: 'MTN',
      phoneNumber: '08012345678',
      type: 'airtime',
    });
  });

  it('binds the payload type to the active tab', () => {
    expect(
      buildAirtimeDataPayload(
        {
          amount: 500,
          networkProvider: 'GLO',
          phoneNumber: '08087654321',
        },
        'data'
      ).type
    ).toBe('data');
  });
});

describe('buildBillPayload', () => {
  const bill = {
    amount: 2500,
    billerCode: 'EKEDC',
    billerName: 'Eko Electricity',
    billItemIdentifier: 'METER-123',
    customerIdentifier: '04012345678',
    productCode: 'PREPAID',
    provider: 'monnify' as const,
    requireValidationRef: true,
    type: 'power',
    validationReference: 'VAL-1',
  };

  it('signs the canonical bill payload', () => {
    expect(buildBillPayload(bill)).toEqual({
      amount: 2500,
      billerCode: 'EKEDC',
      billerName: 'Eko Electricity',
      billItemIdentifier: 'METER-123',
      customerIdentifier: '04012345678',
      productCode: 'PREPAID',
      provider: 'monnify',
      requireValidationRef: true,
      type: 'power',
      validationReference: 'VAL-1',
    });
  });

  it('omits the customer address when absent', () => {
    expect(buildBillPayload(bill)).not.toHaveProperty('customerAddress');
    expect(
      buildBillPayload({ ...bill, customerAddress: '12 Allen Ave' })
        .customerAddress
    ).toBe('12 Allen Ave');
  });
});
