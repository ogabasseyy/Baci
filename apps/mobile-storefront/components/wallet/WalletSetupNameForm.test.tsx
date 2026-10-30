import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSetupNameForm } from './WalletSetupNameForm';

it('validates missing names without attempting a save', () => {
  const onSave = jest.fn();
  render(<WalletSetupNameForm colors={Colors.dark} onSave={onSave} />);
  fireEvent.press(screen.getByRole('button', { name: 'Save and continue' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your first name.');
  expect(onSave).not.toHaveBeenCalled();
});

it('prefills existing names and trims changes before saving', async () => {
  const onSave = jest.fn().mockResolvedValue({ success: true });
  render(
    <WalletSetupNameForm colors={Colors.dark} firstName="Ada" onSave={onSave} />
  );
  expect(screen.getByLabelText('First name').props.value).toBe('Ada');
  fireEvent.changeText(screen.getByLabelText('Last name'), ' Okafor ');
  fireEvent.press(screen.getByRole('button', { name: 'Save and continue' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      first_name: 'Ada',
      last_name: 'Okafor',
    })
  );
});
