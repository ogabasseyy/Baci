export type PaymentMethodSettingCategory = 'gateway' | 'bnpl' | 'offline';

export type PaymentMethodEnabledField = `${string}_enabled`;

export interface PaymentMethodSettingDefinition {
  id: string;
  name: string;
  description: string;
  enabledField: PaymentMethodEnabledField;
  category: PaymentMethodSettingCategory;
}

export const PAYMENT_METHOD_SETTING_DEFINITIONS = [
  {
    id: 'paystack',
    name: 'Paystack',
    description: 'Cards, bank transfer, USSD & mobile money',
    enabledField: 'paystack_enabled',
    category: 'gateway',
  },
  {
    id: 'korapay',
    name: 'Korapay',
    description: 'Card payments and bank transfers',
    enabledField: 'korapay_enabled',
    category: 'gateway',
  },
  {
    id: 'juicyway',
    name: 'Juicy Way',
    description: 'Crypto/Stablecoin payments',
    enabledField: 'juicyway_enabled',
    category: 'gateway',
  },
  {
    id: 'credpal',
    name: 'CredPal',
    description: 'Buy now, pay later in installments',
    enabledField: 'credpal_enabled',
    category: 'bnpl',
  },
  {
    id: 'credit_direct',
    name: 'Credit Direct',
    description: 'Flexible BNPL payment plans',
    enabledField: 'credit_direct_enabled',
    category: 'bnpl',
  },
  {
    id: 'klump',
    name: 'Klump',
    description: 'Buy now, pay later via Klump',
    enabledField: 'klump_enabled',
    category: 'bnpl',
  },
  {
    id: 'oxygen',
    name: 'Oxygen',
    description: 'Device & order financing in installments',
    enabledField: 'oxygen_enabled',
    category: 'bnpl',
  },
  {
    id: 'pay_on_delivery',
    name: 'Pay on Delivery',
    description: 'Cash payment when order arrives',
    enabledField: 'pay_on_delivery_enabled',
    category: 'offline',
  },
] as const satisfies readonly PaymentMethodSettingDefinition[];

export type RegisteredPaymentMethodSetting =
  (typeof PAYMENT_METHOD_SETTING_DEFINITIONS)[number];

export type RegisteredPaymentMethodId = RegisteredPaymentMethodSetting['id'];

const PAYMENT_METHOD_SETTING_BASE_COLUMNS = ['id', 'merchant_id'] as const;

export function getPaymentMethodSettingSelectColumns(
  definitions: readonly PaymentMethodSettingDefinition[] = PAYMENT_METHOD_SETTING_DEFINITIONS
): string {
  return [
    ...PAYMENT_METHOD_SETTING_BASE_COLUMNS,
    ...definitions.map((definition) => definition.enabledField),
  ].join(', ');
}
