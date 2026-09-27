// Format price in Naira
const NGN_PRICE_FORMATTER = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
});

export const formatPrice = (price: number): string => {
  return NGN_PRICE_FORMATTER.format(price);
};
