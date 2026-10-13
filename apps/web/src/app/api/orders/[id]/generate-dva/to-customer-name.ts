export function toCustomerName(customerName: string | null) {
  const nameParts = (customerName || 'Customer').trim().split(' ');
  return {
    firstName: nameParts[0] || 'Customer',
    lastName: nameParts.slice(1).join(' ') || 'User',
  };
}
