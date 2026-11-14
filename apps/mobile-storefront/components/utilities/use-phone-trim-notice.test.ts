import { renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { usePhoneTrimNotice } from './use-phone-trim-notice';

describe('bugfix: the trim notice repeated on the next keystroke (Fable walk 15)', () => {
  it('tells the customer once per overflow', () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() => usePhoneTrimNotice());
    result.current({ digits: '08031234567', trimmed: true });
    // The native field still holds the extra digits: the next keystroke
    // arrives overlong again.
    result.current({ digits: '08031234567', trimmed: true });
    expect(alert).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('tells again after the number was edited below 11 digits', () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() => usePhoneTrimNotice());
    result.current({ digits: '08031234567', trimmed: true });
    result.current({ digits: '0803123456', trimmed: false });
    result.current({ digits: '08031234567', trimmed: true });
    expect(alert).toHaveBeenCalledTimes(2);
    alert.mockRestore();
  });

  it('stays quiet when nothing was dropped', () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() => usePhoneTrimNotice());
    result.current({ digits: '08031234567', trimmed: false });
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
