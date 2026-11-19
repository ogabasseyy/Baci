import { fireEvent, render, screen } from '@testing-library/react-native';
import { OxygenPlanStep } from './OxygenPlanStep';

const limits = {
  productAmount: 198000,
  eligibleAmount: 198000,
  minimumAmount: 10000,
  maxTenure: 3,
  minEquity: 25,
  maxEquity: 90,
};
it('explains why a period exceeds the approved offer', () => {
  render(
    <OxygenPlanStep
      limits={{
        ...limits,
        eligibleAmount: 189000,
        minimumAmount: 68000,
        offers: [
          { tenure: 2, loanAmount: 131000 },
          { tenure: 3, loanAmount: 189000 },
        ],
      }}
      equityPercentage={25}
      tenure={2}
      onEquityChange={jest.fn()}
      onTenureChange={jest.fn()}
      onBook={jest.fn()}
    />
  );
  expect(screen.getByText(/increase your down payment/i)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'See payment breakdown' }).props
      .accessibilityState.disabled
  ).toBe(true);
});
it('explains when no supported percentage can satisfy the offer', () => {
  render(
    <OxygenPlanStep
      limits={{
        ...limits,
        eligibleAmount: 189000,
        minimumAmount: 68000,
        offers: [
          { tenure: 1, loanAmount: 68000 },
          { tenure: 3, loanAmount: 189000 },
        ],
      }}
      equityPercentage={25}
      tenure={1}
      onEquityChange={jest.fn()}
      onTenureChange={jest.fn()}
      onBook={jest.fn()}
    />
  );
  expect(
    screen.getByText('This repayment period is not available for this order.')
  ).toBeTruthy();
});
it('shows one editable formatted amount instead of duplicate amount and percentage fields', () => {
  render(
    <OxygenPlanStep
      limits={limits}
      equityPercentage={25}
      tenure={3}
      onEquityChange={jest.fn()}
      onTenureChange={jest.fn()}
      onBook={jest.fn()}
    />
  );
  expect(screen.getByLabelText('Down payment amount').props.value).toBe(
    '49,500'
  );
  expect(screen.queryByLabelText('Down payment percentage')).toBeNull();
  expect(
    screen.getByRole('button', { name: '3 months' }).props.accessibilityState
      .selected
  ).toBe(true);
});
it('keeps booking explicit and passes the selected terms unchanged', () => {
  const onBook = jest.fn();
  render(
    <OxygenPlanStep
      limits={limits}
      equityPercentage={50}
      tenure={2}
      onEquityChange={jest.fn()}
      onTenureChange={jest.fn()}
      onBook={onBook}
    />
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'See payment breakdown' })
  );
  expect(onBook).toHaveBeenCalledWith({
    action: 'book',
    equityPercentage: 50,
    tenure: 2,
  });
});

it('limits the slider and presets to the selected repayment offer', () => {
  const onEquityChange = jest.fn();
  render(
    <OxygenPlanStep
      limits={{
        ...limits,
        eligibleAmount: 189000,
        minimumAmount: 68000,
        offers: [
          { tenure: 2, loanAmount: 131000 },
          { tenure: 3, loanAmount: 189000 },
        ],
      }}
      equityPercentage={50}
      tenure={2}
      onEquityChange={onEquityChange}
      onTenureChange={jest.fn()}
      onBook={jest.fn()}
    />
  );

  const slider = screen.getByRole('adjustable', {
    name: 'Down payment slider',
  });
  expect(slider.props.accessibilityValue.min).toBe(33.84);
  expect(screen.getByRole('button', { name: '25%' })).toBeDisabled();
  fireEvent(slider, 'layout', { nativeEvent: { layout: { width: 100 } } });
  fireEvent(slider, 'responderGrant', { nativeEvent: { locationX: 25 } });
  expect(onEquityChange).toHaveBeenCalledWith(33.84);
  fireEvent.press(screen.getByRole('button', { name: '50%' }));
  expect(onEquityChange).toHaveBeenLastCalledWith(50);
});

it('keeps a payable offer with one valid rounded percentage selectable', () => {
  render(
    <OxygenPlanStep
      limits={{
        ...limits,
        productAmount: 100000.01,
        eligibleAmount: 66160.01,
        minimumAmount: 66160.01,
        offers: [{ tenure: 3, loanAmount: 66160.01 }],
      }}
      equityPercentage={33.84}
      tenure={3}
      onEquityChange={jest.fn()}
      onTenureChange={jest.fn()}
      onBook={jest.fn()}
    />
  );
  expect(screen.getByRole('adjustable').props.accessibilityValue).toMatchObject(
    {
      min: 33.84,
      max: 33.84,
    }
  );
  expect(
    screen.getByRole('button', { name: 'See payment breakdown' })
  ).toBeEnabled();
});
