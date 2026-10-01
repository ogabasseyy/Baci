/**
 * Jumia Vendor Center API — Shared primitive schemas
 */

import { z } from 'zod';

export const CurrencyAmountSchema = z.object({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code'),
  value: z.number().nonnegative('Currency value must not be negative'),
});

export const CountryInfoSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z]{2}$/, 'Country code must be a 2-letter ISO 3166 code'),
  name: z.string().trim().min(1),
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code'),
});

export const ShippingAddressSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  address: z.string().trim().min(1),
  city: z.string().trim().min(1),
  postalCode: z.string().optional(),
  ward: z.string().optional(),
  region: z.string().trim().min(1),
  countryName: z.string().trim().min(1),
});

export const FulfillmentErrorItemSchema = z.object({
  id: z.string().min(1),
  response: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export const FulfillmentPackageSchema = z.object({
  orderItems: z.array(z.string().min(1)).min(1),
  trackingCode: z.string().min(1),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});

export const ReadyToShipPackageSchema = z.object({
  orderItems: z.array(z.string().min(1)).min(1),
  trackingNumber: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
});

// ── Inferred types ──

export type CurrencyAmount = z.infer<typeof CurrencyAmountSchema>;
export type CountryInfo = z.infer<typeof CountryInfoSchema>;
export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;
export type FulfillmentErrorItem = z.infer<typeof FulfillmentErrorItemSchema>;
export type FulfillmentPackage = z.infer<typeof FulfillmentPackageSchema>;
export type ReadyToShipPackage = z.infer<typeof ReadyToShipPackageSchema>;
