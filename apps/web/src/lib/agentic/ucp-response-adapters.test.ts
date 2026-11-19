import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  adaptCheckoutResponseToUcp,
  buildUcpCheckoutResponse,
  buildUcpOrderResponse,
} from '@/lib/agentic/ucp-response-adapters';

describe('buildUcpCheckoutResponse', () => {
  it('adds UCP metadata and normalizes checkout status, line items, and totals', () => {
    const response = buildUcpCheckoutResponse({
      currency: 'ngn',
      id: 'checkout_1',
      line_items: [
        {
          base_amount: 200_000,
          id: 'line_product_1',
          item: {
            id: 'product_1',
            product_id: 'product_1',
            quantity: 2,
            title: 'Laptop',
          },
          subtotal: 200_000,
          total: 200_000,
        },
      ],
      links: [],
      status: 'ready_for_payment',
      totals: [
        { amount: 200_000, display_text: 'Items', type: 'items_base_amount' },
        { amount: 200_000, display_text: 'Total', type: 'total' },
      ],
    });

    expect(response).toMatchObject({
      status: 'ready_for_complete',
      ucp: {
        capabilities: {
          'dev.ucp.shopping.checkout': [{ version: '2026-04-08' }],
        },
        payment_handlers: {},
        status: 'success',
        version: '2026-04-08',
      },
    });
    expect(response).toMatchObject({
      line_items: [
        {
          item: { id: 'product_1', price: 100_000, title: 'Laptop' },
          quantity: 2,
        },
      ],
      totals: [
        { amount: 200_000, display_text: 'Items', type: 'subtotal' },
        { amount: 200_000, display_text: 'Total', type: 'total' },
      ],
    });
  });

  it('returns UCP error envelopes for non-2xx checkout responses', async () => {
    const response = NextResponse.json({ error: 'Invalid' }, { status: 400 });

    const adapted = await adaptCheckoutResponseToUcp(response);
    const body = await adapted.json();

    expect(adapted.status).toBe(400);
    expect(body).toMatchObject({
      error: 'Invalid',
      messages: [
        {
          content: 'Invalid',
          content_type: 'plain',
          type: 'error',
        },
      ],
      ucp: {
        capabilities: {
          'dev.ucp.shopping.checkout': [{ version: '2026-04-08' }],
        },
        status: 'error',
        version: '2026-04-08',
      },
    });
  });

  it('prefers top-level line item quantities over nested item quantities', () => {
    const response = buildUcpCheckoutResponse({
      line_items: [
        {
          id: 'line_product_1',
          item: {
            id: 'product_1',
            quantity: 1,
            title: 'Laptop',
          },
          quantity: 3,
          total: 300_000,
        },
      ],
      totals: [{ amount: 300_000, display_text: 'Total', type: 'total' }],
    });

    expect(response).toMatchObject({
      line_items: [
        {
          item: { id: 'product_1', price: 100_000, title: 'Laptop' },
          quantity: 3,
        },
      ],
    });
  });

  it('keeps UCP unit prices pre-tax when line totals include VAT', () => {
    const response = buildUcpCheckoutResponse({
      line_items: [
        {
          base_amount: 2_000,
          id: 'line_product_1',
          item: { id: 'product_1', quantity: 2, title: 'Laptop' },
          subtotal: 2_000,
          total: 2_150,
        },
      ],
      totals: [
        { amount: 2_000, display_text: 'Items', type: 'items_base_amount' },
        { amount: 150, display_text: 'Tax', type: 'tax' },
        { amount: 2_150, display_text: 'Total', type: 'total' },
      ],
    });

    expect(response).toMatchObject({
      line_items: [
        {
          item: { id: 'product_1', price: 1_000, title: 'Laptop' },
          quantity: 2,
          totals: [
            { amount: 2_000, type: 'subtotal' },
            { amount: 2_150, type: 'total' },
          ],
        },
      ],
      totals: [
        { amount: 2_000, type: 'subtotal' },
        { amount: 150, type: 'tax' },
        { amount: 2_150, type: 'total' },
      ],
    });
  });

  it('ignores malformed totals entries without throwing', () => {
    const response = buildUcpCheckoutResponse({
      line_items: [],
      totals: [
        null,
        0,
        { amount: 200_000, display_text: 'Total', type: 'total' },
      ],
    });

    expect(response).toMatchObject({
      totals: [
        { amount: 0, display_text: 'Subtotal', type: 'subtotal' },
        { amount: 200_000, display_text: 'Total', type: 'total' },
      ],
    });
  });
});

describe('buildUcpOrderResponse', () => {
  it('adds required UCP order fields while preserving legacy fields', () => {
    const response = buildUcpOrderResponse({
      checkout_id: 'agentic_session_1',
      currency: 'ngn',
      id: 'order_1',
      links: { track_order: 'https://shop.example/track-order' },
      order_items: [
        {
          id: 'item_1',
          line_extension_amount: 150_000,
          name: 'Phone',
          price: 150_000,
          product_id: 'product_1',
          quantity: 1,
        },
      ],
      order_number: 'BACI-1',
      payment_status: 'pending',
      shipping_fee: 2_500,
      shipping_status: 'pending',
      subtotal: 150_000,
      total: 152_500,
      updated_at: '2026-05-17T09:00:00.000Z',
    });

    expect(response).toMatchObject({
      checkout_id: 'agentic_session_1',
      currency: 'NGN',
      id: 'order_1',
      order_number: 'BACI-1',
      permalink_url: 'https://shop.example/track-order',
      fulfillment: {
        events: [
          {
            id: 'event_order_1_pending',
            line_items: [{ id: 'item_1', quantity: 0 }],
            occurred_at: '2026-05-17T09:00:00.000Z',
            type: 'pending',
          },
        ],
        expectations: [],
      },
      ucp: {
        capabilities: {
          'dev.ucp.shopping.order': [{ version: '2026-04-08' }],
        },
        status: 'success',
        version: '2026-04-08',
      },
    });
    expect(response).toMatchObject({
      line_items: [
        {
          item: { id: 'product_1', price: 150_000, title: 'Phone' },
          quantity: { fulfilled: 0, total: 1 },
          status: 'processing',
        },
      ],
      totals: [
        { amount: 150_000, display_text: 'Subtotal', type: 'subtotal' },
        { amount: 2_500, display_text: 'Shipping', type: 'fulfillment' },
        { amount: 152_500, display_text: 'Total', type: 'total' },
      ],
    });
  });

  it('reports order VAT once while keeping the order line price pre-tax', () => {
    const response = buildUcpOrderResponse({
      currency: 'NGN',
      id: 'order_vat',
      order_items: [
        {
          id: 'item_vat',
          line_extension_amount: 2_000,
          name: 'Laptop',
          price: 1_000,
          product_id: 'product_1',
          quantity: 2,
          vat_amount: 150,
        },
      ],
      shipping_fee: 0,
      subtotal: 2_000,
      tax_amount: 150,
      total: 2_150,
    });

    expect(response).toMatchObject({
      line_items: [
        {
          item: { id: 'product_1', price: 1_000, title: 'Laptop' },
          quantity: { total: 2 },
          totals: [{ amount: 2_000, type: 'total' }],
        },
      ],
      totals: [
        { amount: 2_000, type: 'subtotal' },
        { amount: 150, type: 'tax' },
        { amount: 2_150, type: 'total' },
      ],
    });
  });

  it('falls back to the order id when checkout linkage is absent', () => {
    const response = buildUcpOrderResponse({
      checkout_id: null,
      id: 'order_1',
      order_items: [],
    });

    expect(response).toMatchObject({
      checkout_id: 'order_1',
      id: 'order_1',
    });
  });

  it('derives line fulfillment from item fulfillment data and order shipping state', () => {
    const partial = buildUcpOrderResponse({
      checkout_id: 'agentic_session_1',
      id: 'order_1',
      order_items: [
        {
          fulfillment_data: { fulfilled_quantity: 1 },
          id: 'item_1',
          name: 'Phone',
          price: 150_000,
          quantity: 2,
        },
      ],
      shipping_status: 'processing',
    });
    const delivered = buildUcpOrderResponse({
      checkout_id: 'agentic_session_1',
      id: 'order_1',
      order_items: [
        { id: 'item_1', name: 'Phone', price: 150_000, quantity: 2 },
      ],
      shipping_status: 'delivered',
    });

    expect(partial).toMatchObject({
      line_items: [{ quantity: { fulfilled: 1, total: 2 }, status: 'partial' }],
    });
    expect(delivered).toMatchObject({
      line_items: [
        { quantity: { fulfilled: 2, total: 2 }, status: 'fulfilled' },
      ],
    });
  });
});
