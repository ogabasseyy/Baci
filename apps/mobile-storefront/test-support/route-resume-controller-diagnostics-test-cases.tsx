import { expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
import type React from 'react';

export function registerRouteResumeDiagnosticTests(input: {
  RouteResumeController: React.ComponentType<{ shouldResume: boolean }>;
  setRoute: (
    pathname: string,
    searchParams: Record<string, string | string[]>
  ) => void;
  mockReplace: jest.Mock;
}) {
  const { RouteResumeController, setRoute, mockReplace } = input;

  it('logs a coarse resume category without checkout parameters', async () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      setRoute('/cart', { secret: 'private-value' });
      const firstRender = render(
        <RouteResumeController shouldResume={false} />
      );
      firstRender.unmount();
      setRoute('/', {});
      render(<RouteResumeController shouldResume />);
      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      expect(log).toHaveBeenCalledWith(
        '[StartupRoute]',
        'navigation_resume_requested'
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-value');
    } finally {
      log.mockRestore();
    }
  });

  it('preserves payment route query params when restoring', async () => {
    setRoute('/payment-gateway', {
      authorizationUrl: 'https://checkout.paystack.com/test',
      orderId: 'order-123',
    });
    const firstRender = render(<RouteResumeController shouldResume={false} />);

    firstRender.unmount();
    setRoute('/', {});
    render(<RouteResumeController shouldResume />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/payment-gateway?authorizationUrl=https%3A%2F%2Fcheckout.paystack.com%2Ftest&orderId=order-123'
      );
    });
  });
}
