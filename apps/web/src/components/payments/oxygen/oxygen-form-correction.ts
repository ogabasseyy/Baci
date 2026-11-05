/** Never expose provider/schema errors or entered values in customer guidance. */
export function getOxygenFormCorrection(
  issues: readonly { path: readonly PropertyKey[] }[]
) {
  const section = issues[0]?.path[0];
  if (section === 'customer_bank_details')
    return {
      step: 1 as const,
      message: 'Please verify your bank account again before continuing.',
    };
  if (section === 'customer_employment_details')
    return {
      step: 2 as const,
      message:
        'Please review your income and monthly payday before continuing.',
    };
  return {
    step: 0 as const,
    message:
      'Please review your identity and contact details before continuing.',
  };
}
