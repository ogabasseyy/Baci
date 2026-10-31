import { beforeEach, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import Colors from '@/constants/Colors';
import { ImeiReportHistory } from './imei-report-history';
import { cleanResult } from './imei-result.test-fixture';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const report = {
  lookupId: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-10-31T00:00:00Z',
  tier: 'simLock',
  device: 'smartphone',
  result: cleanResult,
};
const props = {
  apiBaseUrl: 'https://test.invalid',
  accessToken: 'test-token',
  scope: 'merchant:customer',
  colors: Colors.light,
  onOpen: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn() as typeof fetch;
});
it('reopens an owned saved report using only GET, with no initial load or checkout', async () => {
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ reports: [report], hasMore: false }),
  } as Response);
  render(<ImeiReportHistory {...props} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'My completed reports' }));
  fireEvent.press(
    await screen.findByRole('button', {
      name: 'Open SIM Lock report for iPhone 13 Pro',
    })
  );
  expect(props.onOpen).toHaveBeenCalledWith(report);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/imei-check/reports?page=0'),
    expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    })
  );
});
it('shows load failure and can retry without a paid submission', async () => {
  jest
    .mocked(fetch)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reports: [], hasMore: false }),
    } as Response);
  render(<ImeiReportHistory {...props} />);
  fireEvent.press(screen.getByRole('button', { name: 'My completed reports' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Retry reports' }));
  await screen.findByText('No completed reports on this page.');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(props.onOpen).not.toHaveBeenCalled();
});
it('does not fetch reports for signed-out users and links to sign-in', () => {
  render(<ImeiReportHistory {...props} accessToken={undefined} />);
  fireEvent.press(screen.getByRole('button', { name: 'My completed reports' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Sign in to view reports' })
  );
  expect(router.push).toHaveBeenCalledWith('/auth/login?returnTo=/imei-check');
  expect(fetch).not.toHaveBeenCalled();
});
it('does not expose the preceding account reports after switching scope', async () => {
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ reports: [report], hasMore: false }),
  } as Response);
  const view = render(<ImeiReportHistory {...props} />);
  fireEvent.press(screen.getByRole('button', { name: 'My completed reports' }));
  await screen.findByRole('button', {
    name: 'Open SIM Lock report for iPhone 13 Pro',
  });
  jest.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  view.rerender(
    <ImeiReportHistory
      {...props}
      scope="merchant:another"
      accessToken="another-token"
    />
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', {
        name: 'Open SIM Lock report for iPhone 13 Pro',
      })
    ).toBeNull()
  );
});
