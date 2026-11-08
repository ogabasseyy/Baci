import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OgabasseyV2HelpSupport } from './help-support';

describe('Ogabassey help support contacts', () => {
  it('uses saved public contacts instead of merchant account contacts', () => {
    render(
      <OgabasseyV2HelpSupport
        merchant={{
          email: 'account@example.com',
          phone: '+2348000000000',
          support_email: ' public@example.com ',
          support_phone: ' +234 916 944 9282 ',
        }}
      />
    );
    expect(
      screen.getByRole('link', { name: 'public@example.com' })
    ).toHaveAttribute('href', 'mailto:public@example.com');
    expect(
      screen.getByRole('link', { name: '+234 916 944 9282' })
    ).toHaveAttribute('href', 'tel:+2349169449282');
    expect(
      screen.queryByRole('link', { name: 'account@example.com' })
    ).not.toBeInTheDocument();
  });

  it('keeps legacy contacts when public support values are blank', () => {
    render(
      <OgabasseyV2HelpSupport
        merchant={{
          email: 'legacy@example.com',
          phone: '+2348000000000',
          support_email: ' ',
          support_phone: ' ',
        }}
      />
    );
    expect(
      screen.getByRole('link', { name: 'legacy@example.com' })
    ).toHaveAttribute('href', 'mailto:legacy@example.com');
    expect(
      screen.getByRole('link', { name: '+2348000000000' })
    ).toHaveAttribute('href', 'tel:+2348000000000');
  });

  it('normalizes fallback FAQs with approved policies when slug is ogabassey', () => {
    render(
      <OgabasseyV2HelpSupport
        merchant={{
          slug: 'ogabassey',
          business_name: 'Ogabassey',
        }}
      />
    );
    const returnQuestion = screen.getByRole('button', {
      name: /what is your return policy/i,
    });
    fireEvent.click(returnQuestion);
    expect(
      screen.getByText(
        /Ogabassey accepts returns for devices with technical defects/i
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/7-day return policy/i)).not.toBeInTheDocument();

    const warrantyQuestion = screen.getByRole('button', {
      name: /how does the warranty work/i,
    });
    fireEvent.click(warrantyQuestion);
    expect(
      screen.getByText(/one-year Ogabassey warranty/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/3-month warranty/i)).not.toBeInTheDocument();
  });

  it('keeps neutral fallback FAQs without stale claims for other merchants', () => {
    render(
      <OgabasseyV2HelpSupport
        merchant={{
          slug: 'other-merchant',
          business_name: 'Other Store',
        }}
      />
    );
    const returnQuestion = screen.getByRole('button', {
      name: /what is your return policy/i,
    });
    fireEvent.click(returnQuestion);
    expect(
      screen.getByText(
        /Contact customer support to confirm return eligibility/i
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/7-day return policy/i)).not.toBeInTheDocument();
  });

  it('renders passed faq_items with approved policy normalization', () => {
    render(
      <OgabasseyV2HelpSupport
        merchant={{
          slug: 'ogabassey',
          faq_items: [
            {
              question: 'What is your return policy?',
              answer: 'Old 7-day policy',
            },
          ],
        }}
      />
    );
    const returnQuestion = screen.getByRole('button', {
      name: /what is your return policy/i,
    });
    fireEvent.click(returnQuestion);
    expect(
      screen.getByText(
        /Ogabassey accepts returns for devices with technical defects/i
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Old 7-day policy/i)).not.toBeInTheDocument();
  });
});
