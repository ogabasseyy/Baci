import { Suspense } from 'react';
import { expect, it, vi } from 'vitest';
import { OrderSuccessContent } from './order-success-content';
import { OrderSuccessRequestMarker } from './order-success-request-marker';
import OrderSuccessPage from './page';

const connection = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('next/server', () => ({ connection }));

it('declares request-time confirmation metadata without blocking the page shell', async () => {
  const layout = OrderSuccessPage();
  const [content, boundary] = layout.props.children;
  expect(content.type).toBe(OrderSuccessContent);
  expect(boundary.type).toBe(Suspense);
  expect(boundary.props.fallback).toBeNull();
  expect(boundary.props.children.type).toBe(OrderSuccessRequestMarker);
  expect(await OrderSuccessRequestMarker()).toBeNull();
  expect(connection).toHaveBeenCalledOnce();
});
