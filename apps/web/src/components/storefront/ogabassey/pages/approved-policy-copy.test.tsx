import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OgabasseyV2HelpSupport } from './help-support';
import { OgabasseyV2LegalDispute } from './legal-dispute';
import { OGABASSEY_RETURN_POLICY_SUMMARY, OGABASSEY_WARRANTY_POLICY_SUMMARY } from '@/lib/storefront-trust/ogabassey-approved-policy';

describe('approved Ogabassey policy presentation', () => {
  it('replaces saved stale FAQ policy answers with approved content', () => {
    render(<OgabasseyV2HelpSupport merchant={{ slug: 'ogabassey', faq_items: [
      { question: 'What is your return policy?', answer: '7 days only' },
      { question: 'How does the warranty work?', answer: '3 months used, manufacturer new' },
    ] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'What is your return policy?' }));
    expect(screen.getByText(OGABASSEY_RETURN_POLICY_SUMMARY)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'How does the warranty work?' }));
    expect(screen.getByText(OGABASSEY_WARRANTY_POLICY_SUMMARY)).toBeInTheDocument();
  });
  it('labels distinct customer support and legal email channels', () => {
    render(<OgabasseyV2LegalDispute merchant={{ slug: 'ogabassey', email: 'legal@example.com', support_email: 'support@example.com' }} />);
    expect(screen.getByRole('link', { name: 'support@example.com' })).toHaveAttribute('href', 'mailto:support@example.com');
    expect(screen.getByRole('link', { name: 'legal@example.com' })).toHaveAttribute('href', 'mailto:legal@example.com');
    expect(screen.getByText('14-Day Return Policy')).toBeInTheDocument();
    expect(screen.queryByText(/voids all warranties/i)).not.toBeInTheDocument();
  });
  it('does not publish Ogabassey policy promises for another tenant using its template', () => {
    render(<OgabasseyV2LegalDispute merchant={{ slug: 'another-store', template_id: 'ogabassey', business_name: 'Another Store' }} />);
    expect(screen.queryByText('14-Day Return Policy')).not.toBeInTheDocument();
    expect(screen.queryByText(/one.year|1.year|7.day|14 days/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Legal Contact' })).toBeInTheDocument();
  });

});
