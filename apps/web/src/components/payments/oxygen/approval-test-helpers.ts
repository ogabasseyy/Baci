import { fireEvent, screen } from '@testing-library/react';

export function continueWithSignature() {
  const file = new File(['signature'], 'signature.png', { type: 'image/png' });
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.change(screen.getByLabelText('Your signature'), {
    target: { files: [file] },
  });
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I accept this payment plan/ })
  );
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  return file;
}
