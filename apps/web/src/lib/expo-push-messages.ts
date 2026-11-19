/** Copy for the one-time "Activate Protection" push after a delivery. */
export function activateProtectionMessage(
  orderId: string,
  orderNumber: string
) {
  return {
    title: '🛡️ Activate your protection',
    body: `Your order #${orderNumber} was delivered. Complete a quick device inspection to activate your insurance cover.`,
    data: {
      type: 'insurance_activation',
      orderId,
      orderNumber,
    },
  };
}
