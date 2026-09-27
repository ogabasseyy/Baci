import {
  buildCartProduct,
  type ConditionType,
  type NormalizedProductDetails,
  type ProductDetailsCurrentOffer,
} from './product-details-helpers';

interface ProductCartHandlersArgs {
  addToCart: (
    product: ReturnType<typeof buildCartProduct>,
    quantity: number,
    metadata?: Record<string, string | Record<string, string> | undefined>
  ) => void;
  applyNegotiatedPrice?: (cartItemId: string, price: number) => void;
  currentCartItemId: string;
  currentOffer: ProductDetailsCurrentOffer;
  canPurchase: boolean;
  getMissingFields: () => string[];
  inputValue: string;
  productData: NormalizedProductDetails;
  quantityInCart: number;
  removeFromCart: (cartItemId: string) => void;
  secondaryColor: number | null;
  selectedAttributes: Record<string, string>;
  selectedColor: number | null;
  selectedCondition: ConditionType;
  selectedImage: number;
  selectedVariantId?: string;
  setInputValue: (value: string) => void;
  setIsNegotiationOpen: (isOpen: boolean) => void;
  setIsSelectionModalOpen: (isOpen: boolean) => void;
  setMissingFields: (
    value: string[] | ((current: string[]) => string[])
  ) => void;
  toast: (args: {
    className?: string;
    description: string;
    title: string;
  }) => void;
  triggerFlyToCart: (startRect: DOMRect) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
}

export function createProductCartHandlers({
  addToCart,
  applyNegotiatedPrice,
  canPurchase,
  currentCartItemId,
  currentOffer,
  getMissingFields,
  inputValue,
  productData,
  quantityInCart,
  removeFromCart,
  secondaryColor,
  selectedAttributes,
  selectedColor,
  selectedCondition,
  selectedImage,
  selectedVariantId,
  setInputValue,
  setIsNegotiationOpen,
  setIsSelectionModalOpen,
  setMissingFields,
  toast,
  triggerFlyToCart,
  updateQuantity,
}: ProductCartHandlersArgs) {
  const buildSelectionMetadata = () => ({
    ...selectedAttributes,
    color:
      selectedColor !== null ? productData.colors[selectedColor]?.name : undefined,
    colorValue:
      selectedColor !== null ? productData.colors[selectedColor]?.value : undefined,
    secondaryColor:
      secondaryColor !== null
        ? productData.colors[secondaryColor]?.name
        : undefined,
    secondaryColorValue:
      secondaryColor !== null
        ? productData.colors[secondaryColor]?.value
        : undefined,
    storage: selectedAttributes.storage,
    condition: selectedCondition,
    variantId: selectedVariantId,
    variantAttributes: selectedVariantId ? selectedAttributes : undefined,
  });

  const validateAndAddToCart = (missing = getMissingFields()) => {
    if (missing.length > 0) {
      setMissingFields(missing);
      setIsSelectionModalOpen(true);
      return false;
    }

    if (!canPurchase) {
      toast({
        title: 'Selection unavailable',
        description: 'This exact selection is currently out of stock.',
        className:
          'border-2 border-store-primary bg-white text-store-background-text',
      });
      return false;
    }

    addToCart(
      buildCartProduct(
        productData,
        currentOffer,
        selectedImage,
        selectedCondition,
        selectedAttributes,
        selectedColor !== null ? productData.colors[selectedColor]?.name : undefined,
        { hasVariantPricing: selectedVariantId != null }
      ),
      1,
      buildSelectionMetadata()
    );

    toast({
      title: 'Added to cart',
      description: `${productData.name} has been added to your cart.`,
      className:
        'border-2 border-store-primary bg-white text-store-background-text',
    });
    return true;
  };

  const handleQuantityBlur = () => {
    if (!currentCartItemId) {
      return;
    }

    let newQuantity = Number.parseInt(inputValue, 10);
    if (Number.isNaN(newQuantity) || newQuantity < 1) {
      setInputValue(String(quantityInCart));
      return;
    }

    if (newQuantity > 99) {
      newQuantity = 99;
    }

    if (newQuantity !== quantityInCart) {
      updateQuantity(currentCartItemId, newQuantity);
    }
  };

  const handleIncrement = () => {
    if (canPurchase && currentCartItemId && quantityInCart < 99) {
      updateQuantity(currentCartItemId, quantityInCart + 1);
    }
  };

  const handleDecrement = () => {
    if (!currentCartItemId || quantityInCart <= 0) {
      return;
    }
    if (quantityInCart <= 1) {
      removeFromCart(currentCartItemId);
      return;
    }
    updateQuantity(currentCartItemId, quantityInCart - 1);
  };

  const handleMobileAddToCart = (startRect: DOMRect) => {
    const missing = getMissingFields();
    const canAnimate = missing.length === 0 && canPurchase;
    if (canAnimate) {
      triggerFlyToCart(startRect);
    }
    validateAndAddToCart(missing);
  };

  const handleNegotiationSuccess = (price: number) => {
    setIsNegotiationOpen(false);

    const missing = getMissingFields();
    if (missing.length > 0) {
      setMissingFields(missing);
      setIsSelectionModalOpen(true);
      return;
    }

    validateAndAddToCart(missing);
    applyNegotiatedPrice?.(currentCartItemId, price);
  };

  return {
    handleDecrement,
    handleIncrement,
    handleMobileAddToCart,
    handleNegotiationSuccess,
    handleQuantityBlur,
    validateAndAddToCart,
  };
}
