import { buildOxygenApplication } from './oxygen-application-command';

it('uses the web customer contract for local and international checkout phone numbers', () => {
  const fields = {
    first_name: 'Test',
    last_name: 'Customer',
    email: 'test@example.invalid',
    bvn: '12345678901',
    nin: '12345678901',
    date_of_birth: '1990-01-01',
    account_number: '0123456789',
    employment_status: 'EMPLOYED',
    salary_amount: '100000',
    salary_date: '25',
  };
  for (const phone of ['08012345678', '+2348012345678']) {
    const result = buildOxygenApplication(
      fields,
      { code: '001', name: 'Access' },
      'Test Customer',
      phone
    );
    expect(result.success).toBe(true);
    if (result.success && result.data.action === 'start_application')
      expect(result.data.customer.customer_personal_details.phone_number).toBe(
        '2348012345678'
      );
  }
});
