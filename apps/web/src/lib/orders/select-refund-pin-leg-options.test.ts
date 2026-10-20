import { describe, expect, it } from 'vitest';
import { selectRefundPinLegOptions } from './select-refund-pin-leg-options';

describe('selectRefundPinLegOptions', () => {
  it('labels each leg with its gateway, reference, and outstanding', () => {
    expect(
      selectRefundPinLegOptions(
        [
          {
            amount: 100,
            gateway: 'paystack',
            id: 'leg-1',
            outstanding: 70,
            reference: 'pp-43a',
          },
          {
            amount: 100,
            gateway: 'paystack',
            id: 'leg-2',
            outstanding: 100,
            reference: 'pp-43b',
          },
        ],
        'NGN'
      )
    ).toEqual([
      { id: 'leg-1', label: 'Paystack · pp-43a · ₦70.00 outstanding' },
      { id: 'leg-2', label: 'Paystack · pp-43b · ₦100.00 outstanding' },
    ]);
  });
  it('falls back to raw gateway and id prefix when metadata is missing', () => {
    const [option] = selectRefundPinLegOptions(
      [
        {
          amount: 50,
          gateway: null,
          id: '9ef12000-0000-4000-8000-000000000057',
          outstanding: 50,
          reference: null,
        },
      ],
      'NGN'
    );
    expect(option.id).toBe('9ef12000-0000-4000-8000-000000000057');
    expect(option.label).toContain('Unknown');
    expect(option.label).toContain('9ef12000');
  });
});
