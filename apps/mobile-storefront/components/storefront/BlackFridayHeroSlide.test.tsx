import { OGABASSEY_BLACK_FRIDAY_DATE_LABEL } from '@baci/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { BlackFridayHeroSlide } from './BlackFridayHeroSlide';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

it('opens the campaign from the dated, accessible home banner', () => {
  render(<BlackFridayHeroSlide width={390} height={220} />);
  fireEvent.press(
    screen.getByRole('button', {
      name: `Shop Black Friday, ${OGABASSEY_BLACK_FRIDAY_DATE_LABEL}`,
    })
  );
  expect(mockPush).toHaveBeenCalledWith('/black-friday');
});
