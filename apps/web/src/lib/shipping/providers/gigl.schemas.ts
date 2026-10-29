import { z } from 'zod';
import {
  GIGL_TRACKING_DESCRIPTION_MAX_LENGTH,
  GIGL_TRACKING_EVENT_ID_MAX_LENGTH,
  GIGL_TRACKING_LOCATION_MAX_LENGTH,
  GIGL_TRACKING_MAX_EVENTS_PER_SHIPMENT,
  GIGL_TRACKING_RAW_STATUS_MAX_LENGTH,
  GIGL_TRACKING_TIMESTAMP_MAX_LENGTH,
} from './gigl.constants';

const optionalStringSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const optionalNumberSchema = z
  .number()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const envelopeObject = z
  .object({
    status: z
      .union([
        z.number(),
        z
          .string()
          .regex(/^[1-5]\d{2}$/)
          .transform(Number),
      ])
      .nullish()
      .transform((value) => value ?? undefined),
    success: z.boolean().optional(),
    message: optionalStringSchema,
    data: z.unknown().optional(),
  })
  .loose();

const loginData = z
  .object({
    'access-token': z.string().min(1),
    UserChannelCode: z.string().min(1),
    UserChannelType: optionalNumberSchema,
    CustomerType: optionalNumberSchema,
  })
  .loose();

const station = z
  .object({
    StationId: z.number(),
    StationName: z.string().min(1),
    StationCode: optionalStringSchema,
    State: optionalStringSchema,
    StateName: optionalStringSchema,
    City: optionalStringSchema,
    Address: optionalStringSchema,
    Latitude: optionalNumberSchema,
    Longitude: optionalNumberSchema,
  })
  .loose();

const serviceCentre = z
  .object({
    StationId: z.number(),
    StationName: z.string().min(1),
    StationCode: optionalStringSchema,
    ServiceCentreId: z.number(),
    ServiceCentreName: z.string().min(1),
    ServiceCentreCode: optionalStringSchema,
    Latitude: optionalNumberSchema,
    Longitude: optionalNumberSchema,
    Address: optionalStringSchema,
  })
  .loose();

const country = z
  .object({
    CountryId: z.number(),
    CountryName: optionalStringSchema,
    CountryCode: optionalStringSchema,
    CountryShortCode: optionalStringSchema,
    IsInternationalShippingCountry: z.boolean().optional(),
  })
  .loose();

const priceData = z
  .object({
    GrandTotal: z.number().positive(),
    MainCharge: optionalNumberSchema,
    DeliverPrice: optionalNumberSchema,
    PickupCharge: optionalNumberSchema,
    InsuranceValue: optionalNumberSchema,
    DeclaredValue: optionalNumberSchema,
    Discount: optionalNumberSchema,
    ShipmentItems: z.array(z.unknown()).optional(),
  })
  .loose();

const internationalPriceRate = z
  .object({
    GrandTotal: z.number().positive(),
    Amount: optionalNumberSchema,
    Currency: optionalStringSchema,
    LogisticCompany: optionalNumberSchema,
    ShipmentMethod: optionalNumberSchema,
    DeliveryType: optionalNumberSchema,
    EstimatedDeliveryDateAndTime: optionalStringSchema,
    DeclaredValue: optionalNumberSchema,
  })
  .loose();

const bookingData = z
  .object({
    Waybill: z.string().min(1),
  })
  .loose();

const internationalBookingData = z
  .object({
    Waybill: optionalStringSchema,
    WaybillNumber: optionalStringSchema,
    waybill: optionalStringSchema,
    RequestNumber: optionalStringSchema,
    requestNumber: optionalStringSchema,
  })
  .loose()
  .refine(
    (data) =>
      [
        data.Waybill,
        data.WaybillNumber,
        data.waybill,
        data.RequestNumber,
        data.requestNumber,
      ].some((value) => value?.trim()),
    { message: 'Booking response is missing a waybill or request number' }
  );

const invoiceData = z
  .object({
    WaybillLabel: z.string().min(1),
  })
  .loose();

const boundedTrackingId = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .refine((value) => String(value).length <= GIGL_TRACKING_EVENT_ID_MAX_LENGTH);

const boundedTrackingString = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value ?? undefined);

const serviceCentreLocation = z
  .object({
    Name: boundedTrackingString(GIGL_TRACKING_LOCATION_MAX_LENGTH),
    Address: boundedTrackingString(GIGL_TRACKING_LOCATION_MAX_LENGTH),
  })
  .loose();

const trackingEvent = z
  .object({
    MobileShipmentTrackingId: boundedTrackingId.optional(),
    ShipmentTrackingId: boundedTrackingId.optional(),
    Status: z.string().trim().min(1).max(GIGL_TRACKING_RAW_STATUS_MAX_LENGTH),
    ScanStatusIncident: boundedTrackingString(
      GIGL_TRACKING_DESCRIPTION_MAX_LENGTH
    ),
    ScanStatusReason: z
      .string()
      .max(GIGL_TRACKING_DESCRIPTION_MAX_LENGTH)
      .nullable()
      .optional()
      .transform((value) => value ?? ''),
    ScanStatusComment: boundedTrackingString(
      GIGL_TRACKING_DESCRIPTION_MAX_LENGTH
    ),
    DateTime: boundedTrackingString(GIGL_TRACKING_TIMESTAMP_MAX_LENGTH),
    DateTimeUtc: boundedTrackingString(GIGL_TRACKING_TIMESTAMP_MAX_LENGTH),
    Location: boundedTrackingString(GIGL_TRACKING_LOCATION_MAX_LENGTH),
    DepartureServiceCentre: serviceCentreLocation.optional(),
  })
  .loose();

const trackingShipment = z
  .object({
    Waybill: optionalStringSchema,
    Origin: optionalStringSchema,
    Destination: optionalStringSchema,
    PickupOptions: optionalNumberSchema,
    DeliveryType: optionalNumberSchema,
    MobileShipmentTrackings: z
      .array(trackingEvent)
      .max(GIGL_TRACKING_MAX_EVENTS_PER_SHIPMENT)
      .nullish()
      .transform((value) => value ?? []),
  })
  .loose();

export const giglSchemas = {
  envelopeObject,
  loginData,
  station,
  stationsData: z.array(station),
  serviceCentre,
  serviceCentresData: z.array(serviceCentre),
  countryData: z.array(country),
  priceData,
  internationalPriceRate,
  internationalPriceData: z.array(internationalPriceRate),
  bookingData,
  internationalBookingData,
  invoiceData,
  trackingEvent,
  trackingShipment,
  trackingData: z.array(trackingShipment),
};

export type GiglStation = z.infer<typeof station>;
export type GiglServiceCentre = z.infer<typeof serviceCentre>;
export type GiglEnvelopeObject = z.infer<typeof envelopeObject>;
