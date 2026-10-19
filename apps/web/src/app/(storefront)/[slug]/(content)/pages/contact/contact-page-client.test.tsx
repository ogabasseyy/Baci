import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
const mockToast = vi.fn();
const { fetchWithCsrfMock } = vi.hoisted(() => ({
  fetchWithCsrfMock: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: fetchWithCsrfMock,
}));

vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/storefront-context', () => ({
  StorefrontProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/app-body', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/storefront/header', () => ({
  StorefrontHeader: () => <div data-testid="header" />,
}));

vi.mock('@/components/storefront/footer', () => ({
  StorefrontFooter: () => <div data-testid="footer" />,
}));

vi.mock('@/components/ui/safe-html', () => ({
  SafeHtml: ({ html, className }: { html: string; className?: string }) => (
    <div className={className} data-testid="safe-html">
      {html}
    </div>
  ),
}));

import { ContactPageClient } from './contact-page-client';

const mockMerchant = {
  id: 'test-merchant-id',
  slug: 'test-store',
  business_name: 'Test Store',
  email: 'store@test.com',
  phone: '+234 123 4567',
  address: '123 Test Street',
};

describe('ContactPageClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders contact form fields', () => {
    render(<ContactPageClient merchant={mockMerchant} />);

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /send message/i })
    ).toBeInTheDocument();
  });

  it('renders merchant contact info when provided', () => {
    render(<ContactPageClient merchant={mockMerchant} />);

    expect(screen.getByText('store@test.com')).toBeInTheDocument();
    expect(screen.getByText('+234 123 4567')).toBeInTheDocument();
    expect(screen.getByText('123 Test Street')).toBeInTheDocument();
  });

  it('renders crawl summary children before the storefront footer', () => {
    render(
      <ContactPageClient merchant={mockMerchant}>
        <section data-testid="crawl-summary">SEO crawl summary</section>
      </ContactPageClient>
    );

    const summary = screen.getByTestId('crawl-summary');
    const footer = screen.getByTestId('footer');

    expect(
      summary.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('submits form with correct field names matching API contract', async () => {
    fetchWithCsrfMock.mockResolvedValueOnce({ ok: true });

    render(<ContactPageClient merchant={mockMerchant} />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'John Doe' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'john@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Test Subject' },
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hello, this is a test message.' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => {
      expect(fetchWithCsrfMock).toHaveBeenCalledWith(
        '/api/forms/submit',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"merchantId"'),
        })
      );
    });

    const body = JSON.parse(fetchWithCsrfMock.mock.calls[0][1].body);
    expect(body).toHaveProperty('merchantId', 'test-merchant-id');
    expect(body).toHaveProperty('formName', 'contact');
    expect(body).toHaveProperty('formData');
    expect(body.formData).toEqual({
      name: 'John Doe',
      email: 'john@example.com',
      subject: 'Test Subject',
      message: 'Hello, this is a test message.',
    });

    // Verify old wrong field names are NOT present
    expect(body).not.toHaveProperty('merchant_id');
    expect(body).not.toHaveProperty('form_type');
    expect(body).not.toHaveProperty('data');
  });

  it('shows success toast on successful submission', async () => {
    fetchWithCsrfMock.mockResolvedValueOnce({ ok: true });

    render(<ContactPageClient merchant={mockMerchant} />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Jane' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Hi' },
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hello!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Message Sent!',
        })
      );
    });
  });

  it('shows error toast on failed submission', async () => {
    fetchWithCsrfMock.mockResolvedValueOnce({ ok: false, status: 500 });

    render(<ContactPageClient merchant={mockMerchant} />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Jane' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Hi' },
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hello!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          variant: 'destructive',
        })
      );
    });
  });

  it('hides contact details section when merchant has no email, phone, or address', () => {
    const merchantWithoutContactInfo = {
      id: 'test-merchant-id',
      slug: 'test-store',
      business_name: 'Test Store',
    };

    render(<ContactPageClient merchant={merchantWithoutContactInfo} />);

    // The form should still be visible
    expect(screen.getByLabelText('Name')).toBeInTheDocument();

    // Contact detail cards should not render
    expect(screen.queryByText('store@test.com')).not.toBeInTheDocument();
    expect(screen.queryByText('+234 123 4567')).not.toBeInTheDocument();
    expect(screen.queryByText('123 Test Street')).not.toBeInTheDocument();
  });
});
