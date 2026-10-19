import { render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import Colors from '@/constants/Colors';
import { CartStatusOnlyScreen } from './CartStatusOnlyScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('./SharedCartStatusPanel', () => ({
  SharedCartStatusPanel: () => null,
}));

it('hosts the status panel in a themed, safe-area-aware scroll view', () => {
  const { UNSAFE_getByType } = render(<CartStatusOnlyScreen />);
  const scroll = UNSAFE_getByType(ScrollView);
  expect(scroll.props.style).toEqual(
    expect.objectContaining({
      flex: 1,
      backgroundColor: Colors.light.background,
    })
  );
  expect(scroll.props.contentContainerStyle).toEqual(
    expect.objectContaining({
      flexGrow: 1,
      paddingTop: 24,
      paddingBottom: 16,
    })
  );
});
