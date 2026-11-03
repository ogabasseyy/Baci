import { describe, expect, it } from 'vitest';
import {
  buildPaymentMethods,
  getPaymentMethodDefinitionsForColumns,
  getPaymentSettingsSelectColumns,
  getRenderablePaymentMethods,
} from './payment-methods';

describe('mobile admin payment method definitions', () => {
  it('hides retired CredPal without removing other configured providers', () => {
    const methods = getRenderablePaymentMethods({
      id: 's',
      merchant_id: 'm',
      credpal_enabled: true,
      credit_direct_enabled: true,
      paystack_enabled: true,
    });
    expect(methods.map((method) => method.id)).not.toContain('credpal');
    expect(methods.map((method) => method.id)).toEqual(
      expect.arrayContaining(['credit_direct', 'paystack'])
    );
  });

  it('builds the admin list from registered provider definitions', () => {
    const methods = buildPaymentMethods([
      {
        category: 'gateway',
        description: 'A newly integrated payment provider',
        enabledField: 'new_gateway_enabled',
        id: 'new_gateway',
        name: 'New Gateway',
      },
    ]);

    expect(methods).toEqual([
      expect.objectContaining({
        category: 'gateway',
        dbField: 'new_gateway_enabled',
        icon: 'card-outline',
        id: 'new_gateway',
        name: 'New Gateway',
      }),
    ]);
  });

  it('returns no admin methods when no provider definitions are registered', () => {
    expect(buildPaymentMethods([])).toEqual([]);
  });

  it('builds the settings select columns from provider definitions', () => {
    const columns = getPaymentSettingsSelectColumns([
      {
        category: 'bnpl',
        description: 'A newly integrated BNPL provider',
        enabledField: 'new_bnpl_enabled',
        id: 'new_bnpl',
        name: 'New BNPL',
      },
    ]);

    expect(columns).toBe('id, merchant_id, new_bnpl_enabled');
  });

  it('returns only base settings columns when no provider definitions are registered', () => {
    expect(getPaymentSettingsSelectColumns([])).toBe('id, merchant_id');
  });

  it('keeps only provider definitions whose columns were selected', () => {
    const definitions = [
      {
        category: 'bnpl',
        description: 'A newly integrated BNPL provider',
        enabledField: 'new_bnpl_enabled',
        id: 'new_bnpl',
        name: 'New BNPL',
      },
      {
        category: 'gateway',
        description: 'A newly integrated gateway provider',
        enabledField: 'new_gateway_enabled',
        id: 'new_gateway',
        name: 'New Gateway',
      },
    ] as const;

    expect(
      getPaymentMethodDefinitionsForColumns(
        ['id', 'merchant_id', 'new_gateway_enabled'],
        definitions
      )
    ).toEqual([definitions[1]]);
  });

  it('omits admin methods when settings lack the backing provider field', () => {
    const methods = buildPaymentMethods([
      {
        category: 'bnpl',
        description: 'A newly integrated BNPL provider',
        enabledField: 'new_bnpl_enabled',
        id: 'new_bnpl',
        name: 'New BNPL',
      },
      {
        category: 'gateway',
        description: 'A newly integrated gateway provider',
        enabledField: 'new_gateway_enabled',
        id: 'new_gateway',
        name: 'New Gateway',
      },
    ]);

    expect(
      getRenderablePaymentMethods(
        {
          id: 'settings-1',
          merchant_id: 'merchant-1',
          new_gateway_enabled: true,
        },
        methods
      ).map((method) => method.id)
    ).toEqual(['new_gateway']);
  });
});
