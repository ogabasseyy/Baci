const EMPTY_PICKER_ERRORS: Record<'city' | 'state', string> = {
  city: 'Choose a city',
  state: 'Choose a state',
};

/**
 * The shared schema words its errors for typed input ("City name must be at
 * least 2 characters"). A picker with nothing chosen gets picker wording.
 */
export function getLocationPickerError(
  valueName: 'city' | 'state',
  value: string | undefined,
  error: string | undefined
): string | undefined {
  if (!error) return undefined;
  return value?.trim() ? error : EMPTY_PICKER_ERRORS[valueName];
}
