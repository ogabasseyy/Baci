import { z } from 'zod';
import {
  AGENTIC_PAYMENT_METHOD_PAYSTACK_BANK_TRANSFER,
  AGENTIC_PAYMENT_PROVIDER_PAY_ON_DELIVERY,
  AGENTIC_PAYMENT_PROVIDER_PAYSTACK,
} from '../config/agentic-payment-methods';

export const agenticCheckoutItemSchema = z.object({
  id: z.string().trim().min(1, 'Item id is required'),
  quantity: z.int().positive('Quantity must be a positive integer'),
});

export const agenticCheckoutItemsSchema = z
  .array(agenticCheckoutItemSchema)
  .min(1, 'At least one item is required');

export const agenticFulfillmentAddressSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.email().optional(),
  phone: z.string().trim().min(7).optional(),
  address: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  country_code: z.string().trim().min(2).max(3).optional(),
  postal_code: z.string().trim().min(1).optional(),
  station_id: z.int().nonnegative().optional(),
});

const checkoutSessionBaseSchema = z.object({
  items: agenticCheckoutItemsSchema,
  shipping_address: agenticFulfillmentAddressSchema.nullable().optional(),
  currency: z
    .string()
    .trim()
    .length(3, 'Currency must be a 3-letter ISO code')
    .transform((value) => value.toUpperCase())
    .default('NGN'),
});

const checkoutSessionCartSchema = z.object({
  cart_id: z.string().trim().min(1, 'Cart id is required'),
  currency: z
    .string()
    .trim()
    .length(3, 'Currency must be a 3-letter ISO code')
    .transform((value) => value.toUpperCase())
    .default('NGN'),
});

export const checkoutSessionSchema = z.preprocess(
  normalizeCheckoutAcpAliases,
  z.union([checkoutSessionBaseSchema, checkoutSessionCartSchema])
);

const createAgenticCheckoutSessionItemSchema = agenticCheckoutItemSchema.extend(
  {
    quantity: z
      .int()
      .positive('Quantity must be a positive integer')
      .max(20, 'Quantity must be 20 or less'),
  }
);

export const createAgenticCheckoutSessionInputSchema = z.preprocess(
  normalizeCheckoutAcpAliases,
  checkoutSessionBaseSchema.extend({
    idempotency_key: z.string().trim().min(8).max(128).optional(),
    items: z.array(createAgenticCheckoutSessionItemSchema).min(1).max(50),
  })
);

const agenticCheckoutSessionIdInputSchema = z.object({
  session_id: z.string().trim().min(1, 'Checkout session id is required'),
});

const agenticCheckoutIdempotencyInputSchema = z.object({
  idempotency_key: z.string().trim().min(8).max(128).optional(),
});

const agenticCheckoutUpdateRequiredMessage =
  'At least one of items, shipping_address, or fulfillment_option_id is required';
const agenticCheckoutUpdateFieldsSchema = z.object({
  fulfillment_option_id: z.string().trim().min(1).nullable().optional(),
  items: agenticCheckoutItemsSchema.optional(),
  shipping_address: agenticFulfillmentAddressSchema.nullable().optional(),
});
const agenticCheckoutUpdateBaseSchema =
  agenticCheckoutUpdateFieldsSchema.refine(hasAgenticCheckoutUpdateField, {
    message: agenticCheckoutUpdateRequiredMessage,
  });

export const agenticCheckoutUpdateSchema = z.preprocess(
  normalizeCheckoutAcpAliases,
  agenticCheckoutUpdateBaseSchema
);

export const getAgenticCheckoutSessionInputSchema =
  agenticCheckoutSessionIdInputSchema;

export const updateAgenticCheckoutSessionInputSchema = z.preprocess(
  normalizeCheckoutAcpAliases,
  agenticCheckoutSessionIdInputSchema
    .extend(agenticCheckoutIdempotencyInputSchema.shape)
    .extend(agenticCheckoutUpdateFieldsSchema.shape)
    .refine(hasAgenticCheckoutUpdateField, {
      message: agenticCheckoutUpdateRequiredMessage,
    })
);

export const cancelAgenticCheckoutSessionInputSchema =
  agenticCheckoutSessionIdInputSchema.extend(
    agenticCheckoutIdempotencyInputSchema.shape
  );

const agenticCheckoutBuyerSchema = z.object({
  email: z.email(),
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  phone_number: z.string().trim().min(7),
});

const humanConfirmationSchema = z.object({
  amount: z.int().nonnegative(),
  confirmed_at: z.iso.datetime(),
  currency: z.string().trim().length(3).transform(toUppercaseCurrency),
  session_id: z.string().trim().min(1),
  signature: z.string().trim().min(32),
  type: z.literal('human_confirmation'),
});

const paymentMandateSchema = z.object({
  currency: z.string().trim().length(3).transform(toUppercaseCurrency),
  expires_at: z.iso.datetime(),
  mandate_id: z.string().trim().min(1),
  max_amount: z.int().nonnegative(),
  session_id: z.string().trim().min(1).optional(),
  signature: z.string().trim().min(32),
  type: z.literal('payment_mandate'),
});

// Paystack provider accepts either the canonical name (`paystack`) or the
// manifest-advertised method name (`paystack_bank_transfer`) as an alias, and
// normalizes the parsed value to the canonical `paystack` so downstream code
// can keep its `provider === 'paystack'` checks unchanged.
const paystackPaymentDataSchema = z.strictObject({
  billing_address: agenticFulfillmentAddressSchema.optional(),
  provider: z
    .union([
      z.literal(AGENTIC_PAYMENT_PROVIDER_PAYSTACK),
      z.literal(AGENTIC_PAYMENT_METHOD_PAYSTACK_BANK_TRANSFER),
    ])
    .transform(() => AGENTIC_PAYMENT_PROVIDER_PAYSTACK),
  token: z.string().trim().min(1),
});

const payOnDeliveryPaymentDataSchema = z.strictObject({
  billing_address: agenticFulfillmentAddressSchema.optional(),
  provider: z.literal(AGENTIC_PAYMENT_PROVIDER_PAY_ON_DELIVERY),
});

const agenticPaymentDataSchema = z.union([
  paystackPaymentDataSchema,
  payOnDeliveryPaymentDataSchema,
]);

export const agenticCheckoutCompleteSchema = z.object({
  buyer: agenticCheckoutBuyerSchema,
  payment_data: agenticPaymentDataSchema,
  completion_authorization: z
    .union([humanConfirmationSchema, paymentMandateSchema])
    .nullish(),
});

export type CheckoutSessionInput = z.infer<typeof checkoutSessionSchema>;
export type AgenticCheckoutUpdateInput = z.infer<
  typeof agenticCheckoutUpdateSchema
>;
export type AgenticCheckoutCompleteInput = z.infer<
  typeof agenticCheckoutCompleteSchema
>;

function toUppercaseCurrency(value: string) {
  return value.toUpperCase();
}

function hasAgenticCheckoutUpdateField(value: {
  fulfillment_option_id?: unknown;
  items?: unknown;
  shipping_address?: unknown;
}) {
  return (
    value.items !== undefined ||
    value.shipping_address !== undefined ||
    value.fulfillment_option_id !== undefined
  );
}

function normalizeCheckoutAcpAliases(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  let normalized: Record<string, unknown> | null = null;
  const ensureNormalized = () => {
    normalized ??= { ...value };
    return normalized;
  };

  if (!Object.hasOwn(value, 'items') && Object.hasOwn(value, 'line_items')) {
    ensureNormalized().items = normalizeCheckoutLineItems(value.line_items);
  }

  if (
    !Object.hasOwn(value, 'shipping_address') &&
    Object.hasOwn(value, 'fulfillment_details')
  ) {
    ensureNormalized().shipping_address = normalizeAcpFulfillmentDetails(
      value.fulfillment_details
    );
  }

  if (
    !Object.hasOwn(value, 'fulfillment_option_id') &&
    Object.hasOwn(value, 'selected_fulfillment_options')
  ) {
    const fulfillmentOptionId = getSelectedFulfillmentOptionId(
      value.selected_fulfillment_options
    );
    if (fulfillmentOptionId !== undefined) {
      ensureNormalized().fulfillment_option_id = fulfillmentOptionId;
    }
  }

  return normalized ?? value;
}

function normalizeCheckoutLineItems(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  return value.map((lineItem) => {
    if (!isRecord(lineItem)) return lineItem;

    const nestedItem = isRecord(lineItem.item) ? lineItem.item : undefined;
    const id =
      getStringField(nestedItem, 'id') ?? getStringField(lineItem, 'id');
    if (!id) return lineItem;

    return {
      id,
      quantity: Object.hasOwn(lineItem, 'quantity') ? lineItem.quantity : 1,
    };
  });
}

function normalizeAcpFulfillmentDetails(value: unknown): unknown {
  if (value === null) return null;
  if (!isRecord(value)) return value;

  const address = isRecord(value.address) ? value.address : undefined;
  const lineOne =
    getStringField(address, 'line_one') ?? getStringField(value, 'address');
  const lineTwo = getStringField(address, 'line_two');
  const country =
    getStringField(address, 'country') ?? getStringField(value, 'country');
  const normalized: Record<string, unknown> = {};

  setOptionalField(
    normalized,
    'name',
    getStringField(value, 'name') ?? getStringField(address, 'name')
  );
  setOptionalField(normalized, 'email', getStringField(value, 'email'));
  setOptionalField(
    normalized,
    'phone',
    getStringField(value, 'phone_number') ?? getStringField(value, 'phone')
  );
  setOptionalField(normalized, 'address', joinAddressLines(lineOne, lineTwo));
  setOptionalField(normalized, 'city', getStringField(address, 'city'));
  setOptionalField(normalized, 'state', getStringField(address, 'state'));
  setOptionalField(normalized, 'country', country);
  if (country && /^[A-Za-z]{2,3}$/.test(country)) {
    normalized.country_code = country.toUpperCase();
  }
  setOptionalField(
    normalized,
    'postal_code',
    getStringField(address, 'postal_code')
  );

  return normalized;
}

function getSelectedFulfillmentOptionId(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;

  const selectedOption = value.find(
    (option) => isRecord(option) && Object.hasOwn(option, 'option_id')
  );

  return isRecord(selectedOption) ? selectedOption.option_id : undefined;
}

function getStringField(
  value: Record<string, unknown> | undefined,
  field: string
): string | undefined {
  const raw = value?.[field];
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim()
    : undefined;
}

function joinAddressLines(
  lineOne: string | undefined,
  lineTwo: string | undefined
) {
  return [lineOne, lineTwo].filter(Boolean).join(', ') || undefined;
}

function setOptionalField(
  target: Record<string, unknown>,
  field: string,
  value: string | undefined
) {
  if (value) {
    target[field] = value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
