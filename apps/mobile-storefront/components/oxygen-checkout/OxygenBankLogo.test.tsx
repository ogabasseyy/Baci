import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'react-native';
import { OxygenBankLogo } from './OxygenBankLogo';
import { oxygenBankLogo } from './oxygen-bank-logos';

it('uses the same bundled source for exact sort-code and NIP aliases', () => {
  expect(oxygenBankLogo('058')).toBeDefined();
  expect(oxygenBankLogo('000013')).toEqual(oxygenBankLogo('058'));
  expect(oxygenBankLogo('044')).not.toEqual(oxygenBankLogo('058'));
  expect(oxygenBankLogo('unknown')).toBeUndefined();
  expect(oxygenBankLogo('constructor')).toBeUndefined();
});

it('falls back after an image error and recovers when another bank is selected', () => {
  const view = render(<OxygenBankLogo code="058" />);
  fireEvent(view.UNSAFE_getByType(Image), 'error');
  expect(view.UNSAFE_queryByType(Image)).toBeNull();
  view.rerender(<OxygenBankLogo code="044" />);
  expect(view.UNSAFE_getByType(Image).props.source).toEqual(
    oxygenBankLogo('044')
  );
});
