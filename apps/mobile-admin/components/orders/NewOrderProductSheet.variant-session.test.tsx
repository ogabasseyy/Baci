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

describe('NewOrderProductSheet variant picker session', () => {
  it('clears prior variant choices when returning to the same parent product', () => {
    const rows = [
      makeVariantRow('variant-1', 'Baci Phone Blue 512GB', [
        { name: 'Color', value: 'Blue' },
        { name: 'Storage', value: '512GB' },
      ]),
      makeVariantRow('variant-2', 'Baci Phone Black 256GB', [
        { name: 'Color', value: 'Black' },
        { name: 'Storage', value: '256GB' },
      ]),
    ];
    const controller = makeController({
      selectableProductRows: rows,
      selectedParentProduct,
    });

    const { rerender } = render(
      <NewOrderProductSheet controller={controller} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select Color Blue' }));
    expect(
      screen.getByRole('button', { name: 'Add selected variant' })
    ).toBeEnabled();

    rerender(
      <NewOrderProductSheet
        controller={makeController({
          isPickingVariant: false,
          selectableProductRows: rows,
          selectedParentProduct: null,
        })}
      />
    );
    rerender(
      <NewOrderProductSheet
        controller={makeController({
          selectableProductRows: rows,
          selectedParentProduct,
        })}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Add selected variant' })
    ).toBeDisabled();
  });

  it('resets variant picking from the back control', () => {
    const controller = makeController();

    render(<NewOrderProductSheet controller={controller} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Back to product list' })
    );

    expect(controller.resetProductPickerState).toHaveBeenCalledTimes(1);
  });

  it('places the variant back control on the left and close control on the right', () => {
    const controller = makeController();

    render(<NewOrderProductSheet controller={controller} />);

    expect(
      screen.getByTestId('product-sheet-leading-accessory')
    ).toContainElement(
      screen.getByRole('button', { name: 'Back to product list' })
    );
    expect(
      screen.getByTestId('product-sheet-trailing-accessory')
    ).toContainElement(
      screen.getByRole('button', { name: 'Close product sheet' })
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Close product sheet' })
    );

    expect(controller.closeProductModal).toHaveBeenCalledTimes(1);
  });
});
