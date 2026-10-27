export function calculateRepairShipping() {
  return Promise.resolve({
    formattedPrice: '₦2,500',
    isFree: false,
    message: 'Estimated pickup fee: ₦2,500',
    price: 2500,
  });
}

export function createRepair() {
  return Promise.resolve({
    success: false,
    code: 'unavailable',
    error: 'Drop-off booking is disabled in this pickup-only fixture.',
  });
}
