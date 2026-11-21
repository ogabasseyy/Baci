import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { McpHandoffImport } from './mcp-handoff-import';

it('shows progress while an automatic cart import is pending', () => {
  render(
    <McpHandoffImport error={null} retry={vi.fn()} openWebsiteCart={vi.fn()} />
  );
  expect(screen.getByRole('status')).toHaveTextContent('Opening your cart');
  expect(screen.queryByRole('button')).toBeNull();
});

it('lets the shopper retry or view their website cart after a failure', () => {
  const retry = vi.fn();
  const openWebsiteCart = vi.fn();
  render(
    <McpHandoffImport
      error="Check your connection."
      retry={retry}
      openWebsiteCart={openWebsiteCart}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Check your connection.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.click(screen.getByRole('button', { name: 'View website cart' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(openWebsiteCart).toHaveBeenCalledOnce();
});
