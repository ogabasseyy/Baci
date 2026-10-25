import { render, screen } from '@testing-library/react';
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
  it('uses the published business address and destination-specific directions', () => {
    const address = '2 Olaide Tomori Street, Ikeja, Lagos, 100001';
    render(<OgabasseyV2HelpSupport merchant={{ business_address: address }} />);
    expect(screen.getByText(address)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get Directions' })).toHaveAttribute(
      'href', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    );
  });

});
