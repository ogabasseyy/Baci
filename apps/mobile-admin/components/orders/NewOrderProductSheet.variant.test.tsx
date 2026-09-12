import './NewOrderProductSheet.variant.test-mocks';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NewOrderProductSheet } from './NewOrderProductSheet';
import {
  makeController,
  makeVariantRow,
  selectedParentProduct,
} from './NewOrderProductSheet.variant.test-support';

describe('NewOrderProductSheet variant mode', () => {
  it('uses the grouped option selector to add a selected variant with fallback parent images', () => {
    const controller = makeController({
      selectableProductRows: [
        makeVariantRow('variant-1', 'Baci Phone Blue 512GB', [
          { name: 'Color', value: 'Blue' },
          { name: 'Storage', value: '512GB' },
        ]),
        makeVariantRow('variant-2', 'Baci Phone Black 256GB', [
          { name: 'Color', value: 'Black' },
          { name: 'Storage', value: '256GB' },
        ]),
      ],
      selectedParentProduct,
    });

    render(<NewOrderProductSheet controller={controller} />);

    expect(screen.getByText('Choose an option')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select Color Blue' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Add selected variant' })
    );

    expect(controller.handleAddProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'variant-1',
        images: ['https://example.com/parent.png'],
      })
    );
    expect(controller.fetchMoreProducts).not.toHaveBeenCalled();
  });

  it('does not duplicate the parent product title above the grouped variant selector', () => {
    const controller = makeController({
      selectableProductRows: [
        makeVariantRow('variant-1', 'Dell Latitude 7420 256GB', [
          { name: 'Ram', value: '16GB' },
          { name: 'Storage', value: '256GB SSD' },
        ]),
        makeVariantRow('variant-2', 'Dell Latitude 7420 512GB', [
          { name: 'Ram', value: '16GB' },
          { name: 'Storage', value: '512GB SSD' },
        ]),
      ],
      selectedParentProduct: {
        ...selectedParentProduct,
        name: 'Dell Latitude 7420',
      },
    });

    render(<NewOrderProductSheet controller={controller} />);

    expect(screen.getAllByText('Dell Latitude 7420')).toHaveLength(1);
  });

  it('adds missing parent ids when no selectable variant options exist', () => {
    const controller = makeController({
      selectableProductRows: [
        makeVariantRow('variant-1', 'Baci Phone Blue', null, {
          parent_product_id: null,
        }),
      ],
      selectedParentProduct,
    });

    render(<NewOrderProductSheet controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Blue' }));

    expect(controller.handleAddProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'variant-1',
        images: ['https://example.com/parent.png'],
        parent_product_id: 'product-parent',
      })
    );
  });
});
