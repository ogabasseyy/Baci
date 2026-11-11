import { describe, expectTypeOf, it } from 'vitest';
import type { ProductEvent, TrackedEvent } from './tracked-event-types';

describe('TrackedEvent', () => {
  it('accepts a complete product event', () => {
    expectTypeOf<ProductEvent>().toExtend<TrackedEvent>();
  });

  it('rejects an event without a merchant id', () => {
    expectTypeOf<{
      event_type: 'add_to_cart';
    }>().not.toExtend<TrackedEvent>();
  });

  it('rejects an unknown event type', () => {
    expectTypeOf<{
      event_type: 'refund';
      merchant_id: string;
    }>().not.toExtend<TrackedEvent>();
  });

  it('rejects a funnel event without its product payload', () => {
    expectTypeOf<{
      event_type: 'add_to_cart';
      merchant_id: string;
    }>().not.toExtend<TrackedEvent>();
  });

  it('rejects a begin_checkout without its order payload', () => {
    expectTypeOf<{
      event_type: 'begin_checkout';
      merchant_id: string;
    }>().not.toExtend<TrackedEvent>();
  });

  it('accepts a page view with only the common fields', () => {
    expectTypeOf<{
      event_type: 'page_view';
      merchant_id: string;
    }>().toExtend<TrackedEvent>();
  });
});
