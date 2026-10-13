export function toCreditOrderCustomerName(customerName: string | null) {
  const parts = (customerName || 'Customer').trim().split(' ');
  return {
    firstName: parts[0] || 'Customer',
    lastName: parts.slice(1).join(' ') || 'User',
  };
}
