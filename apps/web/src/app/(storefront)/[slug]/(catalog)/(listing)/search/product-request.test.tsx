import {
  ProductRequestSubmitError,
  submitProductRequest,
} from '@baci/shared/lib';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProductRequest } from './product-request';

vi.mock('@baci/shared/lib', async (original) => ({
  ...(await original<typeof import('@baci/shared/lib')>()),
  submitProductRequest: vi.fn(),
}));
vi.mock('@/lib/csrf', () => ({ getClientCsrfToken: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ initializeCsrfToken: vi.fn() }));

import { initializeCsrfToken } from '@/lib/api-client';
import { getClientCsrfToken } from '@/lib/csrf';

beforeEach(() => {
  vi.mocked(submitProductRequest).mockReset();
  vi.mocked(getClientCsrfToken)
    .mockReset()
    .mockReturnValue('csrf-cookie-token');
  vi.mocked(initializeCsrfToken).mockReset().mockResolvedValue(null);
});
it('sends the searched product only when the customer submits contact details', async () => {
  vi.mocked(submitProductRequest).mockResolvedValue();
  render(<ProductRequest query="iPhone 20" merchantSlug="ogabassey" />);
  fireEvent.click(screen.getByRole('button', { name: 'Request this product' }));
  expect(screen.getByLabelText('Requested product')).toHaveProperty(
    'value',
    'iPhone 20'
  );
  expect(submitProductRequest).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Email or phone number'), {
    target: { value: 'shopper@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Request sent')
  );
  expect(submitProductRequest).toHaveBeenCalledWith(
    '/api/storefront/product-requests',
    expect.objectContaining({
      query: 'iPhone 20',
      contact: 'shopper@example.com',
      merchantSlug: 'ogabassey',
    }),
    { csrfToken: 'csrf-cookie-token' }
  );
  expect(initializeCsrfToken).not.toHaveBeenCalled();
});
it('keeps failure visible without showing a sent confirmation', async () => {
  vi.mocked(submitProductRequest).mockRejectedValue(new Error('offline'));
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
it('recovers when id generation throws instead of wedging pending', async () => {
  vi.mocked(submitProductRequest).mockResolvedValue();
  const randomUUID = vi
    .spyOn(crypto, 'randomUUID')
    .mockImplementationOnce(() => {
      throw new TypeError('crypto unavailable');
    });
  try {
    render(<ProductRequest query="iPhone 20" merchantSlug="ogabassey" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Request this product' })
    );
    fireEvent.change(screen.getByLabelText('Email or phone number'), {
      target: { value: 'shopper@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Couldn’t send')
    );
    // Pending cleared and the send lock released: the form stays usable.
    expect(screen.getByLabelText('Requested product')).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Send request' })
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Request sent')
    );
  } finally {
    randomUUID.mockRestore();
  }
});
it('falls back to getRandomValues ids in non-secure contexts', async () => {
  vi.mocked(submitProductRequest).mockResolvedValue();
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', {
    value: undefined,
    configurable: true,
  });
  try {
    render(<ProductRequest query="iPhone 20" merchantSlug="ogabassey" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Request this product' })
    );
    fireEvent.change(screen.getByLabelText('Email or phone number'), {
      target: { value: 'shopper@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Request sent')
    );
    expect(submitProductRequest).toHaveBeenCalledWith(
      '/api/storefront/product-requests',
      expect.objectContaining({
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        ),
      }),
      { csrfToken: 'csrf-cookie-token' }
    );
  } finally {
    if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
  }
});
it('shows a retry signal instead of a validation error on idempotency conflict', async () => {
  vi.mocked(submitProductRequest).mockRejectedValue(
    new ProductRequestSubmitError(409, 'conflict')
  );
  render(<ProductRequest query="iPhone 20" merchantSlug="ogabassey" />);
  fireEvent.click(screen.getByRole('button', { name: 'Request this product' }));
  fireEvent.change(screen.getByLabelText('Email or phone number'), {
    target: { value: 'shopper@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'conflicts with an earlier one'
    )
  );
  expect(screen.queryByRole('status')).toBeNull();
});
it('mints a CSRF token for cold sessions before submitting', async () => {
  vi.mocked(submitProductRequest).mockResolvedValue();
  vi.mocked(getClientCsrfToken).mockReturnValue(null);
  vi.mocked(initializeCsrfToken).mockResolvedValue('csrf-minted-token');
  render(<ProductRequest query="iPhone 20" merchantSlug="ogabassey" />);
  fireEvent.click(screen.getByRole('button', { name: 'Request this product' }));
  fireEvent.change(screen.getByLabelText('Email or phone number'), {
    target: { value: 'shopper@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Request sent')
  );
  expect(initializeCsrfToken).toHaveBeenCalledTimes(1);
  expect(submitProductRequest).toHaveBeenCalledWith(
    '/api/storefront/product-requests',
    expect.anything(),
    { csrfToken: 'csrf-minted-token' }
  );
});
