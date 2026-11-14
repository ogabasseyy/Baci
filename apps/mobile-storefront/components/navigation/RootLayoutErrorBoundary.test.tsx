import { render } from '@testing-library/react-native';
import { RootLayoutErrorBoundary } from './RootLayoutErrorBoundary';

const mockRootStartupError = jest.fn();
jest.mock('./RootStartupError', () => ({
  RootStartupError: (props: { error: Error; retry: () => void }) => {
    mockRootStartupError(props);
    return null;
  },
}));

it('forwards the router error and retry action to the startup fallback', () => {
  const error = new Error('startup failed');
  const retry = jest.fn();
  render(<RootLayoutErrorBoundary error={error} retry={retry} />);
  expect(mockRootStartupError).toHaveBeenCalledWith({ error, retry });
});
