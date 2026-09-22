// biome-ignore-all assist/source/organizeImports: index.test-support must be imported before expo-router and ./index — its module-level vi.mock registrations have to run first, and import sorting would reorder them (breaks the suite with a raw-TS transform error).
import { dashboardSetupCardTestSupport } from '../../../__tests__/admin/tabs/dashboard-setup-card.test-support';
import { fireEvent, render, screen } from '@testing-library/react';
import { router } from 'expo-router';
import { beforeEach, describe, expect, it } from 'vitest';
import HomeScreen from './index';

const mocks = dashboardSetupCardTestSupport.getMocks();

describe('HomeScreen', () => {
  beforeEach(() => {
    dashboardSetupCardTestSupport.reset();
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

  it('forwards completed setup readiness to the setup status card', () => {
    render(<HomeScreen />);

    expect(mocks.storeSetupStatusCardProps).toEqual({
      isLive: true,
      isLoading: false,
      readiness: {
        isReady: true,
        isPublished: true,
        overallProgress: 100,
      },
    });
  });

  it('forwards incomplete setup readiness to the setup status card', () => {
    mocks.isLive = false;
    mocks.readiness = {
      isReady: false,
      isPublished: false,
      overallProgress: 71,
    };

    render(<HomeScreen />);

    expect(mocks.storeSetupStatusCardProps).toEqual({
      isLive: false,
      isLoading: false,
      readiness: {
        isReady: false,
        isPublished: false,
        overallProgress: 71,
      },
    });
  });

  it('forwards loading state while setup readiness has not loaded', () => {
    mocks.isReadinessLoading = true;
    mocks.readiness = null;

    render(<HomeScreen />);

    expect(mocks.storeSetupStatusCardProps).toEqual({
      isLive: true,
      isLoading: true,
      readiness: null,
    });
  });

  it('navigates to negotiations when Negotiations quick action is pressed', () => {
    render(<HomeScreen />);

    const button = screen.getByRole('button', { name: 'Negotiations' });
    fireEvent.click(button);

    expect(router.push).toHaveBeenCalledWith('/(admin)/negotiations');
  });
});
