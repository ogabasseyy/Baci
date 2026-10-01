import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { NegotiationUploadForm } from './NegotiationUploadForm';

jest.mock('react-native-reanimated', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    default: { View },
    View,
    FadeIn: {
      duration: () => ({}),
    },
  };
});

function createProps(
  overrides?: Partial<Parameters<typeof NegotiationUploadForm>[0]>
): Parameters<typeof NegotiationUploadForm>[0] {
  return {
    message: 'Upload evidence of a lower price.',
    uploadFile: null,
    uploadLink: '',
    phone: '',
    onPickImage: jest.fn(),
    onUploadLinkChange: jest.fn(),
    onPhoneChange: jest.fn(),
    onBackFromUpload: jest.fn(),
    onUploadSubmit: jest.fn(),
    ...overrides,
  };
}

describe('NegotiationUploadForm', () => {
  it('renders the upload UI with the provided message', () => {
    render(<NegotiationUploadForm {...createProps()} />);

    expect(screen.getByText('Share proof of a lower price')).toBeTruthy();
    expect(screen.getByText('Upload evidence of a lower price.')).toBeTruthy();
    expect(screen.getByText('Upload Photo')).toBeTruthy();
    expect(
      screen.getByPlaceholderText('Paste competitor product URL')
    ).toBeTruthy();
  });

  it('renders the guest-required phone field and reports changes', () => {
    const onPhoneChange = jest.fn();
    render(
      <NegotiationUploadForm {...createProps({ phone: '', onPhoneChange })} />
    );

    const phoneInput = screen.getByLabelText(
      'Phone or WhatsApp number (required for guest requests)'
    );
    expect(phoneInput).toBeTruthy();
    fireEvent.changeText(phoneInput, '0803 123 4567');
    expect(onPhoneChange).toHaveBeenCalledWith('0803 123 4567');
  });

  it('shows the Change Photo label when a file is already attached', () => {
    render(
      <NegotiationUploadForm
        {...createProps({ uploadFile: 'file:///tmp/proof.png' })}
      />
    );

    expect(screen.getByText('Change Photo')).toBeTruthy();
    expect(screen.getByText('Photo attached')).toBeTruthy();
  });

  it('invokes the upload callbacks on user interaction', () => {
    const onPickImage = jest.fn();
    const onUploadLinkChange = jest.fn();
    const onBackFromUpload = jest.fn();
    const onUploadSubmit = jest.fn();

    render(
      <NegotiationUploadForm
        {...createProps({
          onBackFromUpload,
          onPickImage,
          onUploadLinkChange,
          onUploadSubmit,
        })}
      />
    );

    fireEvent.press(screen.getByText('Upload Photo'));
    fireEvent.changeText(
      screen.getByPlaceholderText('Paste competitor product URL'),
      'https://example.com/offer'
    );
    fireEvent.press(screen.getByText('Back'));
    fireEvent.press(screen.getByText('Send for Review'));

    expect(onPickImage).toHaveBeenCalledTimes(1);
    expect(onUploadLinkChange).toHaveBeenCalledWith(
      'https://example.com/offer'
    );
    expect(onBackFromUpload).toHaveBeenCalledTimes(1);
    expect(onUploadSubmit).toHaveBeenCalledTimes(1);
  });
});
