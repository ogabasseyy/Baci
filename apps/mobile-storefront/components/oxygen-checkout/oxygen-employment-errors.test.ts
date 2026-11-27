import { oxygenEmploymentErrors } from './oxygen-employment-errors';

it('accepts valid employment and income fields within bounds', () => {
  expect(
    oxygenEmploymentErrors({
      employment_status: 'EMPLOYED',
      name_of_employer: 'x'.repeat(100),
      salary_amount: '250000.50',
      salary_date: '31',
    })
  ).toEqual({});
});

it('rejects missing or invalid employment status and employer names over 100 characters', () => {
  expect(
    oxygenEmploymentErrors({
      employment_status: 'CONTRACTOR',
      name_of_employer: 'x'.repeat(101),
      salary_amount: '250000',
      salary_date: '1',
    })
  ).toEqual({
    employment_status: 'Select your employment status.',
    name_of_employer: 'Employer name must be 100 characters or fewer.',
  });
});

it('validates monthly salary format and payday boundaries 1 through 31', () => {
  expect(
    oxygenEmploymentErrors({
      employment_status: 'SELF_EMPLOYED',
      salary_amount: 'abc',
      salary_date: '0',
    })
  ).toEqual({
    salary_amount: 'Enter your monthly income.',
    salary_date: 'Select your monthly payday.',
  });

  expect(
    oxygenEmploymentErrors({
      employment_status: 'PENSIONER',
      salary_amount: '1000',
      salary_date: '32',
    })
  ).toEqual({
    salary_date: 'Select your monthly payday.',
  });

  expect(
    oxygenEmploymentErrors({
      employment_status: 'UNEMPLOYED',
      salary_amount: '1000',
      salary_date: '15.5',
    })
  ).toEqual({
    salary_date: 'Select your monthly payday.',
  });
});
