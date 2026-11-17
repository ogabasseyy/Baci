import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  TRACKING_EXPLAINER_COPY,
  TrackingExplainer,
} from './TrackingExplainer';

describe('TrackingExplainer', () => {
  it('explains the coming prompt and offers a single Continue button', () => {
    const onContinue = jest.fn();
    render(<TrackingExplainer visible onContinue={onContinue} />);

    expect(
      screen.getByRole('header', { name: TRACKING_EXPLAINER_COPY.title })
    ).toBeOnTheScreen();
    expect(screen.getByText(TRACKING_EXPLAINER_COPY.purpose)).toBeOnTheScreen();
    expect(screen.getByText(TRACKING_EXPLAINER_COPY.choice)).toBeOnTheScreen();
    // Apple: one way forward to its own prompt, never an Allow/Decline here.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(screen.queryByText(/^allow$/i)).toBeNull();
    expect(screen.queryByText(/not now|no thanks|don't allow/i)).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('offers nothing in return for allowing tracking', () => {
    const copy = Object.values(TRACKING_EXPLAINER_COPY).join(' ');
    expect(copy).not.toMatch(/discount|reward|free|bonus|coupon|win/i);
  });

  it('renders nothing while hidden', () => {
    render(<TrackingExplainer visible={false} onContinue={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
