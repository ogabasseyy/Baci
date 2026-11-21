import { fireEvent, render } from '@testing-library/react-native';
import { OxygenAddressReview } from './OxygenAddressReview';
import { OxygenBreakdown } from './OxygenBreakdown';
import { OxygenPaymentStep } from './OxygenPaymentStep';
import { OxygenPlanStep } from './OxygenPlanStep';
import { OxygenVerificationProgress } from './OxygenVerificationProgress';

const limits = {
  productAmount: 100000,
  eligibleAmount: 75000,
  minimumAmount: 10000,
  maxTenure: 6,
  minEquity: 25,
  maxEquity: 90,
};
describe('native Oxygen presentation', () => {
  it('books only selected server allowed terms, without an invented monthly quote', () => {
    const onBook = jest.fn();
    const view = render(
      <OxygenPlanStep
        limits={limits}
        equityPercentage={25}
        tenure={6}
        onEquityChange={jest.fn()}
        onTenureChange={jest.fn()}
        onBook={onBook}
      />
    );
    expect(view.queryByText('Monthly repayment')).toBeNull();
    fireEvent.press(
      view.getByRole('button', { name: 'See payment breakdown' })
    );
    expect(onBook).toHaveBeenCalledWith({
      action: 'book',
      equityPercentage: 25,
      tenure: 6,
    });
  });
  it('shows exact confirmed amounts and expands only confirmed payment dates', () => {
    const view = render(
      <OxygenBreakdown
        terms={{
          reference: 'ref',
          upfront: 25800,
          monthly: 26250,
          charges: 800,
          schedule: [{ period: 1, date: '2026-12-04', amount: 26250 }],
        }}
        onAccept={jest.fn()}
        onChangePlan={jest.fn()}
      />
    );
    expect(view.getByText('₦25,800.00')).toBeTruthy();
    expect(view.getByText('₦26,250.00')).toBeTruthy();
    expect(view.queryByText('4 Dec 2026')).toBeNull();
    fireEvent.press(view.getByRole('button', { name: 'Show payment dates' }));
    expect(view.getByText('4 Dec 2026')).toBeTruthy();
  });
  it('discloses a different final instalment before expanding dates', () => {
    const view = render(
      <OxygenBreakdown
        terms={{
          reference: 'ref',
          upfront: 25800,
          monthly: 26250,
          charges: 800,
          schedule: [
            { period: 1, date: '2026-12-04', amount: 26250 },
            { period: 2, date: '2027-01-04', amount: 26248.5 },
          ],
        }}
        onAccept={jest.fn()}
        onChangePlan={jest.fn()}
      />
    );
    expect(view.getByText('Final payment: ₦26,248.50')).toBeTruthy();
    expect(view.queryByText('2027-01-04')).toBeNull();
  });
  it('manual review requests a status update and missing local proof requests just the proof', () => {
    const onRefresh = jest.fn();
    const view = render(
      <OxygenAddressReview
        status="reviewing"
        onRefresh={onRefresh}
        onSelectProof={jest.fn()}
      />
    );
    fireEvent.press(view.getByRole('button', { name: 'Check for an update' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(view.queryByText('Select proof of address')).toBeNull();
    view.rerender(
      <OxygenAddressReview
        status="missing_proof"
        onRefresh={onRefresh}
        onSelectProof={jest.fn()}
      />
    );
    expect(view.getByText('Select proof of address')).toBeTruthy();
    expect(view.queryByRole('textbox')).toBeNull();
    view.rerender(
      <OxygenAddressReview
        status="ready"
        onRefresh={onRefresh}
        onSelectProof={jest.fn()}
      />
    );
    expect(
      view.queryByRole('button', { name: 'Check for an update' })
    ).toBeNull();
  });
  it('pending payment cannot invite duplicate payment and confirmed staging stays a checkpoint', () => {
    const onContinue = jest.fn();
    const view = render(
      <OxygenPaymentStep
        state="confirming"
        onContinue={onContinue}
        onRefresh={jest.fn()}
      />
    );
    expect(view.queryByText('Continue payment')).toBeNull();
    view.rerender(
      <OxygenPaymentStep
        state="checkpoint"
        onContinue={onContinue}
        onRefresh={jest.fn()}
      />
    );
    expect(view.getByText('Your upfront steps are complete')).toBeTruthy();
    expect(onContinue).not.toHaveBeenCalled();
  });
  it('leaves pending request recovery to the single workflow recovery control', () => {
    const view = render(
      <OxygenPaymentStep
        state="confirming"
        showRefresh={false}
        onContinue={jest.fn()}
        onRefresh={jest.fn()}
      />
    );
    expect(
      view.queryByRole('button', { name: 'Check for an update' })
    ).toBeNull();
    view.unmount();
    const addressView = render(
      <OxygenAddressReview
        status="reviewing"
        showRefresh={false}
        onRefresh={jest.fn()}
        onSelectProof={jest.fn()}
      />
    );
    expect(
      addressView.queryByRole('button', { name: 'Check for an update' })
    ).toBeNull();
  });
  it('names the actual verification operation', () => {
    const view = render(<OxygenVerificationProgress operation="nin" />);
    expect(view.getByText('Validating your NIN')).toBeTruthy();
  });
  it('allows down payment amount entry within the server limits', () => {
    const onEquityChange = jest.fn();
    const view = render(
      <OxygenPlanStep
        limits={limits}
        equityPercentage={25}
        tenure={6}
        onEquityChange={onEquityChange}
        onTenureChange={jest.fn()}
        onBook={jest.fn()}
      />
    );
    fireEvent.changeText(view.getByLabelText('Down payment amount'), '40000');
    expect(onEquityChange).toHaveBeenCalledWith(40);
  });
});
