import type { ShippingQuote } from './types';

export const merchantShipQuote: ShippingQuote = {
  carrierName: 'Standard Delivery',
  currency: 'INR',
  displayName: 'Standard Delivery',
  estimatedDays: 0,
  id: 'mrate_9f1b2c3d-0000-4000-8000-000000000001',
  insuranceIncluded: false,
  pickupIncluded: false,
  price: 1500,
  provider: 'MERCHANT',
  serviceTier: 'standard',
};

export const merchantPickupQuote: ShippingQuote = {
  ...merchantShipQuote,
  displayName: 'Store Pickup',
  id: 'mrate_9f1b2c3d-0000-4000-8000-000000000002',
  isStationPickup: true,
  serviceTier: 'pickup',
};

export const doorQuote: ShippingQuote = {
  carrierName: 'GIG Logistics',
  currency: 'NGN',
  displayName: 'Door Delivery',
  estimatedDays: 3,
  id: 'door-1',
  insuranceIncluded: true,
  pickupIncluded: true,
  price: 3500,
  provider: 'GIGL',
  serviceTier: 'Standard',
};

export const goFasterQuote: ShippingQuote = {
  ...doorQuote,
  id: 'air-1',
  serviceTier: 'GoFaster',
};

export const stationGoFasterQuote: ShippingQuote = {
  ...goFasterQuote,
  id: 'station-air-1',
  isStationPickup: true,
};

export const stationQuote: ShippingQuote = {
  ...doorQuote,
  displayName: 'Pickup Stations (GIGL)',
  id: 'station-1',
  isStationPickup: true,
  price: 2500,
  stationAddress: '1 Service Centre Road',
  stationName: 'Ikeja Service Centre',
};

export const secondStationQuote: ShippingQuote = {
  ...stationQuote,
  id: 'station-2',
  stationAddress: '5 Allen Avenue',
  stationName: 'Allen Service Centre',
};
