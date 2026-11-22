import { act, fireEvent, render } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { PanResponder } from 'react-native';
import { OxygenSignatureStep } from './OxygenSignatureStep';

let mockCapture: ((value: string) => void) | undefined;
jest.mock('react-native-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: React.forwardRef(
      (props: { children?: import('react').ReactNode }, ref) => {
        React.useImperativeHandle(ref, () => ({
          toDataURL: (callback: (value: string) => void) => {
            mockCapture = callback;
          },
        }));
        return React.createElement('SignatureSvg', {}, props.children);
      }
    ),
    Path: 'SignaturePath',
    Rect: 'SignatureRect',
  };
});
describe('signature consent binding', () => {
  it('requires exact captured terms and confirmed next payment date to continue', () => {
    const onContinue = jest.fn();
    const props = {
      termsKey: 'new',
      accepted: true,
      capturedTermsKey: 'old',
      nextPaymentDate: '2026-12-04',
      onSignature: jest.fn(),
      onAccept: jest.fn(),
      onContinue,
    };
    const view = render(<OxygenSignatureStep {...props} />);
    fireEvent.press(view.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    view.rerender(<OxygenSignatureStep {...props} capturedTermsKey="new" />);
    fireEvent.press(view.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
  it('expands and collapses without resetting a same scope captured signature', () => {
    const onSignature = jest.fn();
    const view = render(
      <OxygenSignatureStep
        termsKey="ref"
        accepted={false}
        capturedTermsKey={null}
        nextPaymentDate="2026-12-04"
        onSignature={onSignature}
        onAccept={jest.fn()}
        onContinue={jest.fn()}
      />
    );
    const expand = view.getByRole('button', { name: 'Expand signature' });
    expect(expand).toHaveStyle({ position: 'absolute', top: 6, right: 6 });
    expect(view.queryByText('Expand signature')).toBeNull();
    expect(expand).toHaveAccessibilityState({ expanded: false });
    fireEvent.press(expand);
    const collapse = view.getByRole('button', { name: 'Collapse signature' });
    expect(collapse).toHaveAccessibilityState({ expanded: true });
    fireEvent.press(collapse);
    expect(onSignature).not.toHaveBeenCalled();
  });
  it('captures PNG consent once after actual strokes and ignores capture after changed terms', () => {
    const createResponder = PanResponder.create;
    jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
      const responder = createResponder(config);
      return {
        ...responder,
        panHandlers: {
          ...responder.panHandlers,
          onResponderGrant: (event) => {
            config.onPanResponderGrant?.(event, {
              stateID: 0,
              moveX: 0,
              moveY: 0,
              x0: 0,
              y0: 0,
              dx: 0,
              dy: 0,
              vx: 0,
              vy: 0,
              numberActiveTouches: 1,
            });
            return true;
          },
        },
      };
    });
    const onSignature = jest.fn();
    const onAccept = jest.fn();
    const props = {
      termsKey: 'ref',
      accepted: false,
      capturedTermsKey: null,
      nextPaymentDate: '2026-12-04',
      onSignature,
      onAccept,
      onContinue: jest.fn(),
    };
    const view = render(
      <StrictMode>
        <OxygenSignatureStep {...props} />
      </StrictMode>
    );
    fireEvent(view.getByLabelText('Draw your signature'), 'responderGrant', {
      nativeEvent: { locationX: 2, locationY: 3 },
    });
    fireEvent.press(
      view.getByRole('checkbox', { name: 'Accept payment plan' })
    );
    act(() => mockCapture?.('iVBORw0KGgo='));
    expect(onAccept).toHaveBeenLastCalledWith(true);
    expect(onSignature).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'signature.png', type: 'image/png' }),
      'ref'
    );
    fireEvent.press(
      view.getByRole('checkbox', { name: 'Accept payment plan' })
    );
    const stale = mockCapture;
    onSignature.mockClear();
    onAccept.mockClear();
    view.rerender(
      <StrictMode>
        <OxygenSignatureStep {...props} termsKey="changed" />
      </StrictMode>
    );
    act(() => stale?.('iVBORw0KGgo='));
    expect(onSignature).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });
});

it('locks the checkout scroll only while a signature stroke is active', () => {
  jest.restoreAllMocks();
  const original = PanResponder.create;
  let config: Parameters<typeof PanResponder.create>[0] | undefined;
  jest.spyOn(PanResponder, 'create').mockImplementation((value) => {
    config = value;
    return original(value);
  });
  const onDrawingChange = jest.fn();
  const { OxygenDrawingControl } = require('./OxygenDrawingControl');
  const view = render(
    <OxygenDrawingControl value={onDrawingChange}>
      <OxygenSignatureStep
        termsKey="key"
        accepted={false}
        capturedTermsKey={null}
        nextPaymentDate="2026-12-04"
        onSignature={jest.fn()}
        onAccept={jest.fn()}
        onContinue={jest.fn()}
      />
    </OxygenDrawingControl>
  );
  act(() =>
    config?.onPanResponderGrant?.(
      { nativeEvent: { locationX: 2, locationY: 3 } } as never,
      {} as never
    )
  );
  expect(onDrawingChange).toHaveBeenLastCalledWith(true);
  act(() => config?.onPanResponderRelease?.({} as never, {} as never));
  expect(onDrawingChange).toHaveBeenLastCalledWith(false);
  view.unmount();
  jest.restoreAllMocks();
});
