import { useEffect, useState } from 'react';

export const OXYGEN_SAVE_ERROR =
  'We could not save your details. Check the message above before continuing.';

export function useOxygenFormError(saveStatus?: string) {
  const [formError, setFormError] = useState('');
  useEffect(() => {
    if (saveStatus === 'saved') {
      setFormError((current) => (current === OXYGEN_SAVE_ERROR ? '' : current));
    }
  }, [saveStatus]);
  return { formError, setFormError };
}
