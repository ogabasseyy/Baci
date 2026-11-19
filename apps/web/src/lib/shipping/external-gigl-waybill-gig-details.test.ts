import { describe, expect, it } from 'vitest';
import { describeExternalWaybillGigDetails } from './external-gigl-waybill-gig-details';
import { giglPreShipment } from './providers/gigl.test-helpers';

const account = { userChannelCode: 'IND405919', userId: 'gig-user' };

describe('describeExternalWaybillGigDetails', () => {
  it('masks the phone and shows a station pickup with the newest update', () => {
    expect(
      describeExternalWaybillGigDetails({
        status: 'found',
        account,
        preShipment: giglPreShipment({
          Waybill: '1349639588',
          ReceiverName: 'Audu Emmanuel',
          ReceiverPhoneNumber: '+234 803 760 8805',
          ReceiverAddress: 'ABAKALIKI (CENTRAL PARK)',
          ReceiverState: 'EBONYI',
          IsHomeDelivery: false,
        }),
        tracking: {
          provider: 'GIGL',
          trackingNumber: '1349639588',
          status: 'in_transit',
          carrierName: 'GIG Logistics',
          events: [
            {
              status: 'booked',
              description: 'Booked',
              timestamp: new Date('2026-10-31T13:00:00Z'),
            },
            {
              status: 'in_transit',
              description: 'Arrived hub',
              location: 'LAGOS GATEWAY',
              timestamp: new Date('2026-10-31T19:55:27Z'),
            },
          ],
        },
      })
    ).toEqual({
      receiverName: 'Audu Emmanuel',
      receiverPhoneLast4: '8805',
      destinationState: 'EBONYI',
      deliveryType: 'station',
      stationAddress: 'ABAKALIKI (CENTRAL PARK)',
      trackingStatus: 'In Transit',
      lastUpdate: {
        description: 'Arrived hub',
        location: 'LAGOS GATEWAY',
        at: '2026-10-31T19:55:27.000Z',
      },
    });
  });

  it('hides the address for home delivery and handles no tracking yet', () => {
    expect(
      describeExternalWaybillGigDetails({
        status: 'found',
        account,
        preShipment: giglPreShipment({
          Waybill: '1',
          ReceiverAddress: '12 Test Street',
          ReceiverPhoneNumber: '12',
          IsHomeDelivery: true,
        }),
        tracking: null,
      })
    ).toMatchObject({
      deliveryType: 'home',
      stationAddress: null,
      receiverPhoneLast4: null,
      trackingStatus: null,
      lastUpdate: null,
    });
  });
});
