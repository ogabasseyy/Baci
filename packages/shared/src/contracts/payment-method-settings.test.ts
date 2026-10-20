import { describe, expect, it } from 'vitest';
import {
  PAYMENT_METHOD_SETTING_DEFINITIONS,
  getPaymentMethodSettingSelectColumns,
} from './payment-method-settings';

describe('payment method setting definitions', () => {
  it('contains the supported provider ids in display order', () => {
    expect(
      PAYMENT_METHOD_SETTING_DEFINITIONS.map((definition) => definition.id)
    ).toEqual([
      'paystack',
      'korapay',
      'juicyway',
      'credpal',
      'credit_direct',
      'klump',
      'pay_on_delivery',
    ]);
  });

  it('keeps every provider definition complete and field-backed', () => {
    for (const definition of PAYMENT_METHOD_SETTING_DEFINITIONS) {
      expect(definition).toEqual(
        expect.objectContaining({
          category: expect.stringMatching(/^(gateway|bnpl|offline)$/),
          description: expect.any(String),
          enabledField: expect.stringMatching(/^[a-z0-9_]+_enabled$/),
          id: expect.any(String),
          name: expect.any(String),
        })
      );
      expect(definition.description.trim()).not.toBe('');
      expect(definition.id.trim()).not.toBe('');
      expect(definition.name.trim()).not.toBe('');
    }
  });

  it('includes Klump in the shared payment provider definitions', () => {
    expect(PAYMENT_METHOD_SETTING_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'bnpl',
          enabledField: 'klump_enabled',
          id: 'klump',
          name: 'Klump',
        }),
      ])
    );
  });

  it('derives select columns from registered payment providers', () => {
    const columns = getPaymentMethodSettingSelectColumns([
      ...PAYMENT_METHOD_SETTING_DEFINITIONS,
      {
        category: 'gateway',
        description: 'A newly integrated payment provider',
        enabledField: 'new_gateway_enabled',
        id: 'new_gateway',
        name: 'New Gateway',
      },
    ]);

    const parsedColumns = columns.split(',').map((column) => column.trim());

    expect(parsedColumns[0]).toBe('id');
    expect(parsedColumns[1]).toBe('merchant_id');
    expect(parsedColumns).toContain('klump_enabled');
    expect(parsedColumns).toContain('new_gateway_enabled');
  });

  it('returns only base columns when no provider definitions are passed', () => {
    expect(getPaymentMethodSettingSelectColumns([])).toBe('id, merchant_id');
  });
});
