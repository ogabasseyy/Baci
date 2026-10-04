export function getMcpOfferAvailability(manageStock: boolean | null | undefined, quantity: number | null | undefined) {
  if (manageStock !== true) return { availability: 'unconfirmed', label: 'Confirm availability' };
  return Number(quantity ?? 0) > 0
    ? { availability: 'in_stock', label: 'In Stock' }
    : { availability: 'out_of_stock', label: 'Out of Stock' };
}
