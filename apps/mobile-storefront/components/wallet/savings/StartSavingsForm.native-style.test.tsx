import { resolve } from 'node:path';
import { expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { Pressable } from 'react-native';
import Colors from '@/constants/Colors';
import { StartSavingsForm } from './StartSavingsForm';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { LocalSavingsFormController } from './start-savings-controller.types';

const { cssInterop } = jest.requireActual<
  typeof import('react-native-css-interop')
>(
  resolve(
    __dirname,
    '../../../../../node_modules/react-native-css-interop/dist/runtime/native/api.js'
  )
);
const NativeWindPressable = cssInterop(Pressable, { className: 'style' });

it.each([
  false,
  true,
])('resolves the draft CTA background, padding and disabled opacity through native interop when canContinue=%s', (canContinue) => {
  const controller: LocalSavingsFormController = {
    searchValue: '',
    setSearchValue: jest.fn(),
    selectedProduct: {
      id: 'phone',
      name: 'Phone',
      image: '',
      slug: 'phone',
      price: 100000,
      variantId: null,
      requiresVariantSelection: false,
    },
    selectedCatalogProduct: null,
    selectProduct: jest.fn(),
    products: [],
    debouncedSearch: '',
    isProductsLoading: false,
    formError: null,
    isSubmitting: false,
    canContinue,
    handleContinue: jest.fn(),
  };
  const form = render(
    <StartSavingsForm
      mode="draft"
      colors={Colors.light}
      controller={controller}
    />
  );
  let button = form.getByRole('button', { name: 'Review savings draft' });
  while (button.parent?.props.accessibilityLabel === 'Review savings draft')
    button = button.parent;
  const native = render(<NativeWindPressable {...button.props} />);
  expect(
    native.getByRole('button', { name: 'Review savings draft' })
  ).toHaveStyle({
    backgroundColor: styles.primaryButton.backgroundColor,
    paddingVertical: styles.primaryButton.paddingVertical,
    borderRadius: styles.primaryButton.borderRadius,
    ...(canContinue ? {} : { opacity: styles.buttonDisabled.opacity }),
  });
});
