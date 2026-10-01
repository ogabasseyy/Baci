/**
 * Jumia Vendor Center API — Zod schemas
 * Barrel file re-exporting all Jumia schema modules.
 */

export {
  type JumiaSelfAuthorizationTokenResponse,
  JumiaSelfAuthorizationTokenResponseSchema,
  type JumiaTokenError,
  JumiaTokenErrorSchema,
  type JumiaTokenResponse,
  JumiaTokenResponseSchema,
} from '@/schemas/jumia/auth';
export {
  JumiaAttributeSchema,
  type JumiaAttributeSetResponse,
  JumiaAttributeSetResponseSchema,
  type JumiaAttributeType,
  type JumiaBrandsResponse,
  JumiaBrandsResponseSchema,
  type JumiaCategoriesResponse,
  JumiaCategoriesResponseSchema,
  type JumiaCategory,
  JumiaCategorySchema,
  JumiaGlobalPriceSchema,
  type JumiaGlobalPriceType,
  type JumiaProduct,
  JumiaProductSchema,
  type JumiaProductsResponse,
  JumiaProductsResponseSchema,
  JumiaSalePriceSchema,
  type JumiaSalePriceType,
  type JumiaStockResponse,
  JumiaStockResponseSchema,
  type JumiaVariation,
  JumiaVariationSchema,
} from '@/schemas/jumia/catalog';
export {
  type ConsignmentFormValues,
  consignmentFormSchema,
  consignmentProductRowSchema,
  getLocalYYYYMMDD,
  isValidCalendarDate,
  type JumiaConsignmentCreateResponse,
  JumiaConsignmentCreateResponseSchema,
  type JumiaConsignmentStockResponse,
  JumiaConsignmentStockResponseSchema,
} from '@/schemas/jumia/consignment';
export {
  type JumiaApiError,
  JumiaApiErrorSchema,
} from '@/schemas/jumia/errors';
export {
  type JumiaExportProduct,
  jumiaExportProductSchema,
} from '@/schemas/jumia/export-product';
export {
  type JumiaExportProductVariation,
  jumiaExportProductVariationSchema,
} from '@/schemas/jumia/export-product-variation';
export {
  type JumiaFeedCreateResponse,
  JumiaFeedCreateResponseSchema,
  type JumiaFeedDetailsResponse,
  JumiaFeedDetailsResponseSchema,
} from '@/schemas/jumia/feeds';
export {
  type JumiaCancelResponse,
  JumiaCancelResponseSchema,
  type JumiaPackV2Response,
  JumiaPackV2ResponseSchema,
  type JumiaPrintLabelsResponse,
  JumiaPrintLabelsResponseSchema,
  type JumiaReadyToShipResponse,
  JumiaReadyToShipResponseSchema,
} from '@/schemas/jumia/fulfillment';
export { jumiaMobileTicketSchema } from '@/schemas/jumia/mobile-ticket';
export {
  type JumiaOrder,
  type JumiaOrderItem,
  type JumiaOrderItemsResponse,
  JumiaOrderItemsResponseSchema,
  type JumiaOrdersResponse,
  JumiaOrdersResponseSchema,
  type JumiaShipmentProvidersResponse,
  JumiaShipmentProvidersResponseSchema,
} from '@/schemas/jumia/orders';
export {
  type CountryInfo,
  CountryInfoSchema,
  type CurrencyAmount,
  CurrencyAmountSchema,
  type FulfillmentErrorItem,
  FulfillmentErrorItemSchema,
  type FulfillmentPackage,
  FulfillmentPackageSchema,
  type ReadyToShipPackage,
  ReadyToShipPackageSchema,
  type ShippingAddress,
  ShippingAddressSchema,
} from '@/schemas/jumia/shared';
export {
  type JumiaBusinessClient,
  JumiaBusinessClientSchema,
  type JumiaShop,
  JumiaShopSchema,
  type JumiaShopsResponse,
  JumiaShopsResponseSchema,
} from '@/schemas/jumia/shops';
