import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SeeAllResultsButton } from './SeeAllResultsButton';

describe('SeeAllResultsButton', () => {
  it('submits the current query when pressed', () => {
    const onSeeAllResults = jest.fn();

    render(
      <SeeAllResultsButton
        colors={Colors.light}
        currentQuery="iphone 15 pro"
        onSeeAllResults={onSeeAllResults}
      />
    );

    fireEvent.press(screen.getByLabelText('See all results for iphone 15 pro'));
    expect(onSeeAllResults).toHaveBeenCalledTimes(1);
    expect(onSeeAllResults).toHaveBeenCalledWith('iphone 15 pro');
  });
});
