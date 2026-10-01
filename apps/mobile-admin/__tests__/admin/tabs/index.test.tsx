// biome-ignore assist/source/organizeImports: load test-support mocks before the screen module
import { fireEvent, render, screen } from '@testing-library/react';
import { homeScreenTestSupport } from './index.test-support';
import { router } from 'expo-router';
import { beforeEach, describe, expect, it } from 'vitest';
import HomeScreen from '../../../app/(admin)/(tabs)/index';

const mocks = homeScreenTestSupport.getMocks();

describe('HomeScreen', () => {
  beforeEach(() => {
    homeScreenTestSupport.reset();
  });

  it('reserves the top safe area on the dashboard tab', () => {
    render(<HomeScreen />);

    screen.getByText('welcome-header');
    screen.getByText('Visits');
    screen.getByText('New');
    expect(mocks.safeAreaEdges).toEqual(['top']);
  });

  it('keeps concise metric labels when scoped to a single branch', () => {
    mocks.branchScope = { isAllLocations: false };

    render(<HomeScreen />);

    screen.getByText('Visits');
    screen.getByText('New');
    expect(screen.queryByText('Visits (all stores)')).toBeNull();
    expect(screen.queryByText('New (all stores)')).toBeNull();
  });

  it('navigates to negotiations when Negotiations quick action is pressed', () => {
    render(<HomeScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Negotiations' }));

    expect(router.push).toHaveBeenCalledWith('/(admin)/negotiations');
  });

  it('delegates store avatar selection to the upload helper', () => {
    render(<HomeScreen />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Change store avatar' })
    );

    expect(mocks.pickAndUploadFavicon).toHaveBeenCalledWith(
      expect.any(Function),
      { invalidateQueries: mocks.invalidateQueries }
    );
  });
});
