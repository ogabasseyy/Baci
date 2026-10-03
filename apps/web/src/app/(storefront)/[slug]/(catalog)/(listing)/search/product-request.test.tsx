import { sendProductRequest } from '@baci/shared/lib';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProductRequest } from './product-request';

vi.mock('@baci/shared/lib', async (original) => ({
  ...(await original<typeof import('@baci/shared/lib')>()),
  sendProductRequest: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: vi.fn() }),
}));
beforeEach(() => {
  vi.mocked(sendProductRequest).mockReset();
});
it('sends the searched product only when the customer submits contact details', async () => {
  vi.mocked(sendProductRequest).mockResolvedValue();
  render(<ProductRequest query="iPhone 20" merchantSlug="ogabassey" />);
  fireEvent.click(screen.getByRole('button', { name: 'Request this product' }));
  expect(screen.getByLabelText('Requested product')).toHaveProperty(
    'value',
    'iPhone 20'
  );
  expect(sendProductRequest).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Email or phone number'), {
    target: { value: 'shopper@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Request sent')
  );
});
it('keeps failure visible without showing a sent confirmation', async () => {
  vi.mocked(sendProductRequest).mockRejectedValue(new Error('offline'));
  render(<ProductRequest query="iPhone 20" merchantSlug="ogabassey" />);
  fireEvent.click(screen.getByRole('button', { name: 'Request this product' }));
  fireEvent.change(screen.getByLabelText('Email or phone number'), {
    target: { value: 'shopper@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t send')
  );
  expect(screen.queryByRole('status')).toBeNull();
});
