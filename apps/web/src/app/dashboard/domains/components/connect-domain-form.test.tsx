// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRefresh = vi.fn();
const mockToast = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { ConnectDomainForm } from './connect-domain-form';

describe('ConnectDomainForm multi-record Cloudflare for SaaS onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles 202 provisioning responses without result.verification.value and refreshes async TXT records', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            domain: { id: 'd1', domain: 'shop.example.com' },
            lifecycleState: 'provisioning',
            verificationRecords: [
              {
                name: 'shop.example.com',
                purpose: 'routing',
                status: 'pending',
                type: 'CNAME',
                value: 'customers.usebaci.com',
              },
            ],
          }),
          { status: 202 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            domain: 'shop.example.com',
            lifecycleState: 'pending_verification',
            verificationRecords: [
              {
                name: 'shop.example.com',
                purpose: 'routing',
                status: 'pending',
                type: 'CNAME',
                value: 'customers.usebaci.com',
              },
              {
                name: '_acme-challenge.shop.example.com',
                purpose: 'cloudflare_ssl_dcv',
                status: 'pending',
                type: 'TXT',
                value: 'async-dcv-token',
              },
            ],
          }),
          { status: 200 }
        )
      );

    render(<ConnectDomainForm />);

    const input = screen.getByPlaceholderText('example.com');
    fireEvent.change(input, { target: { value: 'shop.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => {
      expect(screen.getByText('Provisioning')).toBeTruthy();
      expect(screen.getByText('customers.usebaci.com')).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /refresh dns records/i })
    );

    await waitFor(() => {
      expect(screen.getByText('Pending DNS Verification')).toBeTruthy();
      expect(screen.getByText('async-dcv-token')).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/domains/shop.example.com/verification'
    );
    fetchMock.mockRestore();
  });
});
