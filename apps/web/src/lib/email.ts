/** @deprecated Merchant welcomes are delivered by the durable onboarding worker. */
export function sendWelcomeEmail(_to: string, _name: string) {
  return Promise.resolve({
    success: false,
    error: 'Legacy welcome sender retired',
  });
}
