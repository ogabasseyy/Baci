import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SwapTradeInUploadStep } from './SwapTradeInUploadStep';

function renderUploadStep(overrides = {}) {
  const props = {
    colors: Colors.light,
    error: null,
    isAnalyzing: false,
    onClearMedia: jest.fn(),
    onPickMedia: jest.fn(),
    onRecordVideo: jest.fn(),
    onStartAnalysis: jest.fn(),
    mediaLabel: null,
    ...overrides,
  };

  render(<SwapTradeInUploadStep {...props} />);

  return props;
}

describe('SwapTradeInUploadStep', () => {
  it('renders upload choices and forwards picker actions', () => {
    const props = renderUploadStep();

    fireEvent.press(screen.getByText('Select Photos or Video'));
    fireEvent.press(screen.getByText('Record Video'));

    expect(
      screen.getByText('Upload Photos or a Video of Your Device')
    ).toBeTruthy();
    expect(props.onPickMedia).toHaveBeenCalledTimes(1);
    expect(props.onRecordVideo).toHaveBeenCalledTimes(1);
  });

  it('renders the selected media and starts analysis', () => {
    const props = renderUploadStep({ mediaLabel: '3 photos selected' });

    fireEvent.press(screen.getByText('Remove'));
    fireEvent.press(screen.getByText('Analyze Device'));

    expect(screen.getByText('3 photos selected')).toBeTruthy();
    expect(props.onClearMedia).toHaveBeenCalledTimes(1);
    expect(props.onStartAnalysis).toHaveBeenCalledTimes(1);
  });

  it('shows upload errors', () => {
    renderUploadStep({ error: 'Video is too long' });

    expect(screen.getByText('Video is too long')).toBeTruthy();
  });
});
