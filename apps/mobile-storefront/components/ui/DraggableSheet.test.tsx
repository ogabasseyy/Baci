import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { DraggableSheet } from './DraggableSheet';

function renderSheet(
  overrides: Partial<Parameters<typeof DraggableSheet>[0]> = {}
) {
  const onClose = jest.fn();
  render(
    <DraggableSheet
      visible
      title="Filters"
      closeLabel="Close filters"
      onClose={onClose}
      {...overrides}
    >
      <Text>Sheet body</Text>
    </DraggableSheet>
  );
  return { onClose };
}

describe('DraggableSheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the title, children, and close control when visible', () => {
    renderSheet();

    expect(screen.getByText('Filters')).toBeTruthy();
    expect(screen.getByText('Sheet body')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close filters' })).toBeTruthy();
    expect(screen.getByTestId('mock-bottom-sheet')).toBeTruthy();
  });

  it('renders nothing actionable when hidden', () => {
    renderSheet({ visible: false });

    expect(screen.queryByText('Filters')).toBeNull();
    expect(screen.queryByTestId('mock-bottom-sheet')).toBeNull();
  });

  it('invokes onClose once from the close control', () => {
    const { onClose } = renderSheet();

    fireEvent.press(screen.getByRole('button', { name: 'Close filters' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes only through the sheet when the backdrop is pressed', () => {
    renderSheet();

    const backdropComponent = screen.getByTestId('mock-bottom-sheet').props
      .backdropComponent as (props: object) => {
      props: Record<string, unknown>;
    };
    const backdrop = backdropComponent({});

    // pressBehavior="close" drives BottomSheet's onClose; the backdrop must
    // not also carry onPress or a tap would invoke onClose twice.
    expect(backdrop.props.pressBehavior).toBe('close');
    expect(backdrop.props.onPress).toBeUndefined();
  });
});
