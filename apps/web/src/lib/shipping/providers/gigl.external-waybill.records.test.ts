import { describe, expect, it } from 'vitest';
import {
  isGiglWaybillOwnedByAccount,
  pickPreShipment,
  readGiglErrorMessage,
} from './gigl.external-waybill';
import { giglPreShipment } from './gigl.test-helpers';

const ACCOUNT_USER_ID = 'e9de76d8-208a-44b6-bf02-9842fb8a9bee';

function statusResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('isGiglWaybillOwnedByAccount', () => {
  const account = { userChannelCode: 'IND405919', userId: ACCOUNT_USER_ID };

  it('accepts a waybill whose customer code and user id match', () => {
    expect(
      isGiglWaybillOwnedByAccount(
        { CustomerCode: 'ind405919', UserId: ACCOUNT_USER_ID.toUpperCase() },
        account
      )
    ).toBe(true);
  });

  it('rejects a waybill booked on another GIG account', () => {
    expect(
      isGiglWaybillOwnedByAccount(
        { CustomerCode: 'IND000001', UserId: ACCOUNT_USER_ID },
        account
      )
    ).toBe(false);
    expect(
      isGiglWaybillOwnedByAccount(
        { CustomerCode: 'IND405919', UserId: 'another-user' },
        account
      )
    ).toBe(false);
  });

  it('fails closed when GIG returns no account identifiers', () => {
    expect(
      isGiglWaybillOwnedByAccount(
        { CustomerCode: undefined, UserId: undefined },
        account
      )
    ).toBe(false);
  });
});

describe('readGiglErrorMessage', () => {
  it('reads the GIG message from an error body', async () => {
    await expect(
      readGiglErrorMessage(
        statusResponse(401, { message: 'Shipment Details Not Found.' }),
        new AbortController().signal
      )
    ).resolves.toBe('Shipment Details Not Found.');
  });

  it('gives up on an oversized cloned body that never closes', async () => {
    const original = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(20 * 1_024));
        },
      }),
      { status: 401, headers: { 'Content-Length': String(64 * 1_024) } }
    );
    const controller = new AbortController();
    const read = readGiglErrorMessage(original.clone(), controller.signal);
    controller.abort(new Error('deadline'));
    await expect(read).resolves.toBe('');
  });

  it('gives up when the lookup deadline fires while the body stalls', async () => {
    const stalled = new Response(
      new ReadableStream<Uint8Array>({ start() {} }),
      { status: 401 }
    );
    const controller = new AbortController();
    const read = readGiglErrorMessage(stalled, controller.signal);
    controller.abort(new Error('deadline'));
    await expect(read).resolves.toBe('');
  });
});

describe('pickPreShipment', () => {
  const owned = giglPreShipment({
    Waybill: '1349639588',
    CustomerCode: 'IND405919',
    UserId: ACCOUNT_USER_ID,
  });

  it('picks the matching record regardless of case', () => {
    expect(pickPreShipment([owned], ' 1349639588 ')).toEqual(owned);
    expect(pickPreShipment([owned], '999')).toBeUndefined();
  });

  it('fails closed when same-waybill records name different accounts', () => {
    const foreign = giglPreShipment({
      Waybill: '1349639588',
      CustomerCode: 'IND000001',
      UserId: 'someone-else',
    });
    const picked = pickPreShipment([owned, foreign], '1349639588');
    expect(picked).toMatchObject({
      CustomerCode: undefined,
      UserId: undefined,
    });
    expect(
      isGiglWaybillOwnedByAccount(picked ?? owned, {
        userChannelCode: 'IND405919',
        userId: ACCOUNT_USER_ID,
      })
    ).toBe(false);
  });
});
