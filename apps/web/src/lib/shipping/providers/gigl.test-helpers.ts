import type { BookingRequest, QuoteRequest } from '@/lib/shipping/types';
import { type GiglPreShipment, giglSchemas } from './gigl.schemas';

export const baseUrl = 'https://dev-thirdpartynode.theagilitysystems.com';

export const loginResponse = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: {
      'access-token': 'test-access-token',
      UserChannelCode: 'ECO038082',
      UserChannelType: 2,
      CustomerType: 0,
    },
  },
};

export const loginResponseWithoutCustomerType = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: {
      'access-token': 'test-access-token',
      UserChannelCode: 'ECO038082',
      UserChannelType: 2,
    },
  },
};

export function loginResponseWithToken(
  token: string,
  userChannelCode = 'ECO038082',
  userChannelType = 2
) {
  return {
    success: true,
    data: {
      message: 'Success',
      status: 200,
      data: {
        'access-token': token,
        UserChannelCode: userChannelCode,
        UserChannelType: userChannelType,
      },
    },
  };
}

export const stationsResponse = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: [
      {
        StationId: 4,
        StationName: 'LAGOS',
        StationCode: 'LOS',
        State: 'LAGOS',
        StateName: 'LAGOS',
        City: 'LAGOS',
        CountryName: 'NIGERIA',
        Address: 'Lagos station',
        Latitude: 6.5244,
        Longitude: 3.3792,
      },
      {
        StationId: 30,
        StationName: 'PORT HARCOURT',
        StationCode: 'PHC',
        State: 'RIVERS',
        StateName: 'RIVERS',
        City: 'PORT HARCOURT',
        CountryName: 'NIGERIA',
        Address: 'Port Harcourt station',
        Latitude: 4.8156,
        Longitude: 7.0498,
      },
    ],
  },
};

export const serviceCentresResponse = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: [
      {
        StationId: 30,
        StationName: 'PORT HARCOURT',
        StationCode: 'PHC',
        ServiceCentreId: 575,
        ServiceCentreName: 'PHC RUMUOLUMENI IWOFE',
        ServiceCentreCode: 'RUM',
        Latitude: 4.816,
        Longitude: 7.05,
        Address: 'Eagle Cement Junction, Rumuolumeni, Port Harcourt',
      },
      {
        StationId: 30,
        StationName: 'PORT HARCOURT',
        StationCode: 'PHC',
        ServiceCentreId: 407,
        ServiceCentreName: 'PHC PETER ODILLI',
        ServiceCentreCode: 'PPO',
        Latitude: 4.82,
        Longitude: 7.05,
        Address: '89 Peter Odili Road, Port Harcourt',
      },
      {
        StationId: 30,
        StationName: 'PORT HARCOURT',
        StationCode: 'PHC',
        ServiceCentreId: 524,
        ServiceCentreName: 'PHC D-LINE',
        ServiceCentreCode: 'DLINEPH',
        Latitude: 4.83,
        Longitude: 7.06,
        Address: '34 Igboukwu Street, Port Harcourt',
      },
      {
        StationId: 30,
        StationName: 'PORT HARCOURT',
        StationCode: 'PHC',
        ServiceCentreId: 565,
        ServiceCentreName: 'HUAWEI-PHC',
        ServiceCentreCode: 'HWI-PHC',
        Latitude: 5,
        Longitude: 7.5,
        Address: 'Port Harcourt',
      },
    ],
  },
};

export const failedStationsEnvelope = {
  success: true,
  data: {
    message: 'Provider unavailable',
    status: 503,
    data: null,
  },
};

export const internationalCountriesResponse = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: [
      {
        CountryId: 36,
        CountryName: 'Canada',
        CountryCode: 'CANADA',
        CountryShortCode: 'CA',
        IsInternationalShippingCountry: true,
      },
    ],
  },
};

export const priceResponse = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: {
      GrandTotal: 8941.43,
      DeliverPrice: 8500,
      PickupCharge: 300,
      InsuranceValue: 141.43,
      DeclaredValue: 100000,
    },
  },
};

export const bookingResponse = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: {
      Waybill: 'GIGL-WB-1',
    },
  },
};

export const quoteRequest: QuoteRequest = {
  sessionId: 'session-1',
  shipmentType: 'domestic',
  sender: {
    name: 'Ogabassey',
    phone: '08000000000',
    address: 'Ikeja, Lagos',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  receiver: {
    name: 'Customer',
    phone: '08000000001',
    address: 'Port Harcourt, Rivers',
    city: 'Port Harcourt',
    state: 'Rivers',
    country: 'Nigeria',
    countryCode: 'NG',
    latitude: 4.8156,
    longitude: 7.0498,
  },
  items: [
    {
      name: 'Phone',
      description: 'Phone',
      quantity: 1,
      weight: 1,
      value: 100000,
      hsCode: '851712',
    },
  ],
};

export const bookingRequest: BookingRequest = {
  orderId: 'order-1',
  quoteId: 'quote-1',
  providerRateId: 'GIGL_30_1',
  sender: {
    name: 'Ogabassey',
    phone: '08000000000',
    address: 'Ikeja, Lagos',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
    latitude: 0,
    longitude: 0,
  },
  receiver: {
    name: 'Customer',
    phone: '08000000001',
    address: 'Port Harcourt, Rivers',
    city: 'Port Harcourt',
    state: 'Rivers',
    country: 'Nigeria',
    countryCode: 'NG',
    latitude: 0,
    longitude: 0,
  },
  items: [
    {
      name: 'Phone',
      description: 'Phone',
      quantity: 1,
      weight: 1,
      value: 100000,
      hsCode: '851712',
    },
  ],
};

export function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function abortingFetchResponse(_url: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const abort = () => {
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Builds a pre-shipment the way GIG's `/get/preshipment` response parses. */
export function giglPreShipment(
  fields: Record<string, unknown> & { Waybill: string }
): GiglPreShipment {
  const [preShipment] = giglSchemas.preShipmentData.parse([fields]);
  if (!preShipment) throw new Error('Pre-shipment fixture did not parse');
  return preShipment;
}
