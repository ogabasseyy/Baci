import { describe, expect, it } from 'vitest';
import { matchExternalWaybillToOrder } from './gigl-external-waybill-match';

const order = {
  customer_name: 'Audu Emmanuel',
  customer_phone: '08037608805',
  shipping_address: { city: 'Abakaliki', phone: null, state: 'Ebonyi' },
};

const receiver = {
  ReceiverName: 'AUDU EMMANUEL',
  ReceiverPhoneNumber: '+2348037608805',
  ReceiverState: 'EBONYI',
};

describe('matchExternalWaybillToOrder', () => {
  it('links when the name, phone and destination state agree', () => {
    expect(matchExternalWaybillToOrder(order, receiver)).toEqual({
      name: 'match',
      phone: 'match',
      destination: 'match',
      linkable: true,
    });
  });

  it('needs the phone even when the names match', () => {
    const result = matchExternalWaybillToOrder(order, {
      ...receiver,
      ReceiverName: 'Emmanuel Audu',
      ReceiverPhoneNumber: undefined,
    });
    expect(result).toMatchObject({ name: 'match', phone: 'unknown' });
    expect(result.linkable).toBe(false);
  });

  it('refuses a name match when the phone clearly differs', () => {
    const result = matchExternalWaybillToOrder(order, {
      ...receiver,
      ReceiverName: 'Emmanuel Audu',
      ReceiverPhoneNumber: '+2348000000000',
    });
    expect(result).toMatchObject({ name: 'match', phone: 'mismatch' });
    expect(result.linkable).toBe(false);
  });

  it('accepts a renamed receiver when the phone matches', () => {
    const result = matchExternalWaybillToOrder(order, {
      ...receiver,
      ReceiverName: 'Chidi Okafor',
    });
    expect(result).toMatchObject({ name: 'mismatch', phone: 'match' });
    expect(result.linkable).toBe(true);
  });

  it('refuses a parcel for someone else', () => {
    const result = matchExternalWaybillToOrder(order, {
      ...receiver,
      ReceiverName: 'Chidi Okafor',
      ReceiverPhoneNumber: '+2348111111111',
    });
    expect(result.linkable).toBe(false);
  });

  it('refuses a parcel going to another state', () => {
    const result = matchExternalWaybillToOrder(order, {
      ...receiver,
      ReceiverState: 'LAGOS',
    });
    expect(result).toMatchObject({ destination: 'mismatch', linkable: false });
  });

  it('treats the FCT spellings as one destination', () => {
    const result = matchExternalWaybillToOrder(
      {
        ...order,
        shipping_address: { ...order.shipping_address, state: 'Abuja' },
      },
      { ...receiver, ReceiverState: 'FEDERAL CAPITAL TERRITORY' }
    );
    expect(result.destination).toBe('match');
  });

  it('needs a matching phone when the order has no state', () => {
    const withoutState = { ...order, shipping_address: null };
    expect(matchExternalWaybillToOrder(withoutState, receiver)).toMatchObject({
      destination: 'unknown',
      linkable: true,
    });
    expect(
      matchExternalWaybillToOrder(withoutState, {
        ...receiver,
        ReceiverPhoneNumber: undefined,
      }).linkable
    ).toBe(false);
  });

  it('does not match on one shared name alone', () => {
    const result = matchExternalWaybillToOrder(order, {
      ...receiver,
      ReceiverName: 'Emmanuel Okafor',
      ReceiverPhoneNumber: '+2348111111111',
    });
    expect(result).toMatchObject({ name: 'mismatch', linkable: false });
    expect(
      matchExternalWaybillToOrder(order, {
        ...receiver,
        ReceiverName: 'AUDU',
        ReceiverPhoneNumber: '+2348111111111',
      }).name
    ).toBe('match');
  });

  it('does not skip the destination when GIG omits it for an order that has one', () => {
    expect(
      matchExternalWaybillToOrder(order, {
        ...receiver,
        ReceiverState: undefined,
      })
    ).toMatchObject({ destination: 'unknown', linkable: false });
  });

  it('reports unknown when GIG omits the receiver details', () => {
    expect(
      matchExternalWaybillToOrder(order, {
        ReceiverName: undefined,
        ReceiverPhoneNumber: undefined,
        ReceiverState: undefined,
      })
    ).toEqual({
      name: 'unknown',
      phone: 'unknown',
      destination: 'unknown',
      linkable: false,
    });
  });
});
