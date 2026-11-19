import { describe, expect, it } from 'vitest';
import { parseStoredPiggyvestEvent } from './webhook-capture-stored-event';

const accrued = {
  eventId: 'evt-accrued-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5 },
};

const bytes = (text: string) => new TextEncoder().encode(text);
const encoded = (payload: unknown) => bytes(JSON.stringify(payload));

describe('parseStoredPiggyvestEvent', () => {
  it('reads stored bytes into the event the receiver would have parsed', () => {
    expect(parseStoredPiggyvestEvent(encoded(accrued))).toMatchObject({
      eventType: 'interest-accrued.success',
      eventId: 'evt-accrued-1',
    });
  });

  it('keeps multi-byte text intact', () => {
    const event = parseStoredPiggyvestEvent(
      encoded({ ...accrued, customer_id: 'Ọlá-ñ-💸' })
    );
    expect(event).toMatchObject({ customer_id: 'Ọlá-ñ-💸' });
  });

  it.each([
    ['empty bytes', new Uint8Array()],
    ['text that is not JSON', bytes('{not json')],
    ['a JSON scalar', bytes('42')],
    ['JSON null', bytes('null')],
    ['an array', bytes('[]')],
    ['an object with no event type', encoded({ eventId: 'evt-1' })],
    ['an unknown event type', encoded({ ...accrued, eventType: 'x.y' })],
    [
      'a known event type with a malformed body',
      encoded({
        eventId: 'evt-inflow-1',
        eventType: 'bank-transfer.inflow.success',
        eventData: {},
      }),
    ],
  ])('returns null for %s: a content quarantine', (_label, rawBody) => {
    expect(parseStoredPiggyvestEvent(rawBody)).toBeNull();
  });

  it('rejects invalid UTF-8 inside an otherwise valid event instead of replacing it', () => {
    // 0xff can never appear in UTF-8. A lenient decoder would turn it into
    // U+FFFD and accept bytes the receiver's strict parser refuses.
    const before = bytes(
      '{"eventId":"evt-1","eventType":"interest-accrued.success","eventCategory":"interest_accrued","customer_id":"cust-'
    );
    const after = bytes('","eventData":{"id":"accrual-1","amount":12.5}}');
    const withByte = (middle: number[]) =>
      new Uint8Array([...before, ...middle, ...after]);

    expect(parseStoredPiggyvestEvent(withByte([0x31]))).toMatchObject({
      customer_id: 'cust-1',
    });
    expect(parseStoredPiggyvestEvent(withByte([0xff]))).toBeNull();
    expect(parseStoredPiggyvestEvent(withByte([0xc3, 0x28]))).toBeNull();
  });
});
