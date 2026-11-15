import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { OgabasseyPdpServerPrimaryDetails } from './server-primary-details';

describe('OgabasseyPdpServerPrimaryDetails', () => {
  it('renders only structured specifications so marketing description ownership stays deferred', () => {
    render(
      <OgabasseyPdpServerPrimaryDetails
        detailedSpecs={[
          {
            category: 'Charging',
            items: [
              { label: 'Power output', value: '20W USB-C' },
              { label: 'Compatibility', value: 'USB-C charging cable' },
            ],
          },
        ]}
        productName="Apple Fast Charger 20W"
      />
    );

    const region = screen.getByRole('region', {
      name: 'Apple Fast Charger 20W overview and specifications',
    });

    expect(
      within(region).queryByRole('heading', {
        name: 'Apple Fast Charger 20W product overview',
      })
    ).toBeNull();
    expect(within(region).getAllByText('Power output')).toHaveLength(2);
    expect(within(region).getAllByText('20W USB-C')).toHaveLength(2);
  });

  it('does not render a marketing description when no specifications exist', () => {
    const { container } = render(
      <OgabasseyPdpServerPrimaryDetails
        detailedSpecs={[]}
        productName="iPhone 16 Pro"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('retains safe structured specification rendering', () => {
    render(
      <OgabasseyPdpServerPrimaryDetails
        detailedSpecs={[
          {
            category: 'General',
            items: [{ label: 'Warranty', value: 'One year' }],
          },
        ]}
        productName="iPhone 16 Pro"
      />
    );

    expect(screen.getAllByText('Warranty')).toHaveLength(2);
    expect(screen.getAllByText('One year')).toHaveLength(2);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders malformed stored spec sections with a safe category fallback', () => {
    render(
      <OgabasseyPdpServerPrimaryDetails
        detailedSpecs={
          [
            {
              category: undefined,
              items: [{ label: 'Face value', value: '₦30 gift card' }, null],
            },
          ] as unknown as ComponentProps<
            typeof OgabasseyPdpServerPrimaryDetails
          >['detailedSpecs']
        }
        productName="Apple iTunes Gift Card 30"
      />
    );

    expect(screen.getByRole('heading', { name: 'General' })).toBeVisible();
    expect(screen.getAllByText('Face value')).toHaveLength(2);
    expect(screen.getAllByText('₦30 gift card')).toHaveLength(2);
  });

  it('renders nothing when there is no useful product copy', () => {
    const { container } = render(
      <OgabasseyPdpServerPrimaryDetails
        detailedSpecs={[
          { category: 'Empty', items: [{ label: '', value: '' }] },
        ]}
        productName="Empty Product"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
