import {
  getPaymentMethodSettingSelectColumns,
  PAYMENT_METHOD_SETTING_DEFINITIONS,
  type PaymentMethodEnabledField,
  type PaymentMethodSettingCategory,
  type PaymentMethodSettingDefinition,
} from '@baci/shared';
import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';
import type { PaymentSettings } from '@/schemas/payment-settings';

export type PaymentMethodCategory = PaymentMethodSettingCategory;

export type PaymentMethodField = PaymentMethodEnabledField;

export interface PaymentMethod {
  id: string;
  name: string;
  icon: IoniconsIconName;
  description: string;
  dbField: PaymentMethodField;
  category: PaymentMethodCategory;
}

const PAYMENT_METHOD_ICON_BY_ID: Partial<Record<string, IoniconsIconName>> = {
  credit_direct: 'time-outline',
  juicyway: 'flash-outline',
  klump: 'calendar-outline',
  korapay: 'wallet-outline',
  pay_on_delivery: 'cash-outline',
  paystack: 'card-outline',
};

export function buildPaymentMethods(
  definitions: readonly PaymentMethodSettingDefinition[] = PAYMENT_METHOD_SETTING_DEFINITIONS
): readonly Readonly<PaymentMethod>[] {
  return definitions.map((definition) => ({
    id: definition.id,
    name: definition.name,
    icon: PAYMENT_METHOD_ICON_BY_ID[definition.id] ?? 'card-outline',
    description: definition.description,
    dbField: definition.enabledField,
    category: definition.category,
  }));
}

export function getPaymentSettingsSelectColumns(
  definitions: readonly PaymentMethodSettingDefinition[] = PAYMENT_METHOD_SETTING_DEFINITIONS
): string {
  return getPaymentMethodSettingSelectColumns(definitions);
}

export function getPaymentMethodDefinitionsForColumns(
  columns: readonly string[],
  definitions: readonly PaymentMethodSettingDefinition[] = PAYMENT_METHOD_SETTING_DEFINITIONS
): readonly PaymentMethodSettingDefinition[] {
  const selectedColumns = new Set(columns);
  return definitions.filter((definition) =>
    selectedColumns.has(definition.enabledField)
  );
}

export function getRenderablePaymentMethods(
  settings: PaymentSettings | undefined,
  methods: readonly Readonly<PaymentMethod>[] = paymentMethods
): readonly Readonly<PaymentMethod>[] {
  if (!settings) return [];

  return methods.filter(
    (method) =>
      method.id !== 'credpal' && Object.hasOwn(settings, method.dbField)
  );
}

export const paymentMethods = buildPaymentMethods();

export const paymentSettingsSelectColumns = getPaymentSettingsSelectColumns();
