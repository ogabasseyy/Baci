import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductDesignHighlights } from './product-design-highlights';

describe('ProductDesignHighlights', () => {
  it('does not promote editorial instructions or uncertain catalog notes into feature cards', () => {
    render(
      <ProductDesignHighlights
        specs={[
          {
            label: 'Battery',
            value:
              'Apple publishes tablet battery capacity in watt-hours; do not force an mAh scalar',
          },
          {
            label: 'Camera',
            value:
              '12MP class on most listed iPad models; confirm exact generation',
          },
          { label: 'Processor', value: 'Apple A14 Bionic' },
        ]}
      />
    );
    expect(screen.queryByText(/do not force/)).toBeNull();
    expect(screen.queryByText(/confirm exact/)).toBeNull();
    expect(screen.getByText('Apple A14 Bionic')).toBeVisible();
  });
  it('renders real normalized model facts without pretending configuration facts are fixed', () => {
    render(
      <ProductDesignHighlights
        specs={[
          { label: 'Processor', value: 'Helio G99' },
          { label: 'RAM', value: '6GB' },
          { label: 'Storage', value: '128GB' },
          { label: 'Display', value: '11-inch' },
        ]}
      />
    );
    expect(screen.getByText('Helio G99')).toBeInTheDocument();
    expect(screen.getByText('11-inch')).toBeInTheDocument();
    expect(screen.queryByText('6GB')).not.toBeInTheDocument();
    expect(screen.queryByText('128GB')).not.toBeInTheDocument();
  });

  it('omits an empty highlight section instead of inventing specifications', () => {
    const { container } = render(<ProductDesignHighlights specs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses accessory facts and limits the highlight list to four', () => {
    render(
      <ProductDesignHighlights
        specs={[
          'Weight',
          'Material',
          'Compatibility',
          'Cable length',
          'Warranty',
        ].map((label) => ({ label, value: `${label} from catalog` }))}
      />
    );
    expect(screen.getByText('Material from catalog')).toBeInTheDocument();
    expect(screen.queryByText('Warranty from catalog')).not.toBeInTheDocument();
    expect(screen.getAllByRole('term')).toHaveLength(4);
  });
});
