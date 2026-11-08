import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { DeviceAssuranceContent } from './device-assurance-content';
import { metadata } from './page';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('../trust-route-context', () => ({ getTrustRouteContext: lookup }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
beforeEach(() => {
  lookup.mockReset();
});
it('provides a specific description for the guide', () => {
  expect(metadata.description).toMatch(/inspecting a phone or laptop/i);
});
it('shows inspection guidance and links using only published policy summaries for OgaBassey', async () => {
  lookup.mockResolvedValue({
    merchant: { id: OGABASSEY_MERCHANT_ID, email: 'support@example.test' },
    baseUrl: 'https://ogabassey.com',
    trustProfile: {
      returnPolicy: { summary: 'Published return terms' },
      warrantyPolicy: { summary: 'Published warranty terms' },
    },
  });
  render(
    await DeviceAssuranceContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
    })
  );
  expect(screen.getByText('Published return terms')).toBeInTheDocument();
  expect(screen.getByText('Published warranty terms')).toBeInTheDocument();
  for (const path of ['/returns', '/warranty', '/contact', '/imei-check'])
    expect(
      screen.getByRole('link', {
        name: new RegExp(path.slice(1).replace('-', ' '), 'i'),
      })
    ).toHaveAttribute('href', `https://ogabassey.com${path}`);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('main')).not.toBeInTheDocument();
});
it('omits missing policy promises and still links to the policy pages', async () => {
  lookup.mockResolvedValue({
    merchant: { id: OGABASSEY_MERCHANT_ID },
    baseUrl: 'https://ogabassey.com',
    trustProfile: {},
  });
  render(
    await DeviceAssuranceContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
    })
  );
  expect(screen.queryByText('Published return terms')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /returns/i })).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: /warranty/i })
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/warranty policy is not available/i)
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: /contact/i })
  ).not.toBeInTheDocument();
});
it('rejects other merchants even if they use the OgaBassey template', async () => {
  lookup.mockResolvedValue({
    merchant: { id: 'another-merchant', template_id: 'ogabassey' },
    baseUrl: 'https://other.example',
    trustProfile: {},
  });
  await expect(
    DeviceAssuranceContent({ params: Promise.resolve({ slug: 'other' }) })
  ).rejects.toThrow('NEXT_NOT_FOUND');
});
it('rejects an unresolved storefront', async () => {
  lookup.mockResolvedValue(null);
  await expect(
    DeviceAssuranceContent({ params: Promise.resolve({ slug: 'unknown' }) })
  ).rejects.toThrow('NEXT_NOT_FOUND');
});
it('shows contact when the published support profile has an address', async () => {
  lookup.mockResolvedValue({
    merchant: { id: OGABASSEY_MERCHANT_ID },
    baseUrl: 'https://ogabassey.com',
    trustProfile: { supportEmail: 'support@example.test' },
  });
  render(
    await DeviceAssuranceContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
    })
  );
  expect(screen.getByRole('link', { name: /contact/i })).toHaveAttribute(
    'href',
    'https://ogabassey.com/contact'
  );
});
