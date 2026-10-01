import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

import { RepairDeviceCatalog } from './RepairDeviceCatalog';

const groups = [
  {
    brand: 'Apple',
    devices: [
      {
        id: 'd1',
        brand: 'Apple',
        model: 'iPhone 13',
        slug: 'apple-iphone-13',
        deviceType: 'Smartphone' as const,
        imageUrl: null,
        productId: null,
      },
    ],
  },
  {
    brand: 'Samsung',
    devices: [
      {
        id: 'd2',
        brand: 'Samsung',
        model: 'Galaxy S22',
        slug: 'samsung-galaxy-s22',
        deviceType: 'Smartphone' as const,
        imageUrl: null,
        productId: null,
      },
    ],
  },
];

describe('RepairDeviceCatalog', () => {
  const onQueryChange = jest.fn();
  const onSelectDevice = jest.fn();
  const onDescribeInstead = jest.fn();
  const onChatWhatsapp = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders devices grouped by brand', () => {
    render(
      <RepairDeviceCatalog
        groups={groups}
        query=""
        onQueryChange={onQueryChange}
        onSelectDevice={onSelectDevice}
        onDescribeInstead={onDescribeInstead}
        onChatWhatsapp={onChatWhatsapp}
      />
    );

    expect(screen.getAllByText('Apple')).toHaveLength(2);
    expect(screen.getByText('iPhone 13')).toBeTruthy();
    expect(screen.getAllByText('Samsung')).toHaveLength(2);
    expect(screen.getByText('Galaxy S22')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Filter by Apple'));

    expect(onQueryChange).toHaveBeenCalledWith('Apple');
  });

  it('calls onQueryChange as the search input changes', () => {
    render(
      <RepairDeviceCatalog
        groups={groups}
        query=""
        onQueryChange={onQueryChange}
        onSelectDevice={onSelectDevice}
        onDescribeInstead={onDescribeInstead}
        onChatWhatsapp={onChatWhatsapp}
      />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Search your device (e.g. iPhone 13)'),
      'iphone'
    );

    expect(onQueryChange).toHaveBeenCalledWith('iphone');
  });

  it('calls onSelectDevice with the pressed device', () => {
    render(
      <RepairDeviceCatalog
        groups={groups}
        query=""
        onQueryChange={onQueryChange}
        onSelectDevice={onSelectDevice}
        onDescribeInstead={onDescribeInstead}
        onChatWhatsapp={onChatWhatsapp}
      />
    );

    fireEvent.press(screen.getByText('iPhone 13'));

    expect(onSelectDevice).toHaveBeenCalledWith(groups[0].devices[0]);
  });

  it('shows an empty-search message when no groups match a query', () => {
    render(
      <RepairDeviceCatalog
        groups={[]}
        query="nokia"
        onQueryChange={onQueryChange}
        onSelectDevice={onSelectDevice}
        onDescribeInstead={onDescribeInstead}
        onChatWhatsapp={onChatWhatsapp}
      />
    );

    expect(screen.getByText(/No devices found for "nokia"/)).toBeTruthy();
  });

  it('keeps all brand shortcuts available when the current search is filtered', () => {
    render(
      <RepairDeviceCatalog
        groups={[groups[0]]}
        brandGroups={groups}
        query="apple"
        onQueryChange={onQueryChange}
        onSelectDevice={onSelectDevice}
        onDescribeInstead={onDescribeInstead}
        onChatWhatsapp={onChatWhatsapp}
      />
    );

    expect(screen.getByLabelText('Filter by Samsung')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Filter by Samsung'));

    expect(onQueryChange).toHaveBeenCalledWith('Samsung');
  });

  it('wires the not-listed CTAs to their callbacks', () => {
    render(
      <RepairDeviceCatalog
        groups={groups}
        query=""
        onQueryChange={onQueryChange}
        onSelectDevice={onSelectDevice}
        onDescribeInstead={onDescribeInstead}
        onChatWhatsapp={onChatWhatsapp}
      />
    );

    fireEvent.press(screen.getByLabelText('Describe your device instead'));
    fireEvent.press(screen.getByLabelText('Chat on WhatsApp'));

    expect(onDescribeInstead).toHaveBeenCalled();
    expect(onChatWhatsapp).toHaveBeenCalled();
  });
});
