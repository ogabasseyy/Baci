import { renderHook } from '@testing-library/react-native';
import { useAddressSuggestionsSpace } from './use-address-suggestions-space';

it('scrolls once when results arrive, without chasing field movement', () => {
  const onRequestSpace = jest.fn();
  const predictions = [
    {
      placeId: 'one',
      description: 'Test street',
      mainText: 'Test street',
      secondaryText: 'Lagos',
    },
  ];
  const props = {
    predictions,
    anchor: { x: 26, y: 530, width: 340, height: 52 },
    host: { x: 10, y: 100, width: 380, height: 700 },
    keyboardTop: 600,
    contentHeight: 128,
    onRequestSpace,
  };
  const { rerender } = renderHook(useAddressSuggestionsSpace, {
    initialProps: props,
  });
  expect(onRequestSpace).toHaveBeenCalledWith(122);
  rerender({ ...props, anchor: { ...props.anchor, y: 500 } });
  expect(onRequestSpace).toHaveBeenCalledTimes(1);
  rerender({ ...props, predictions: [] });
  rerender(props);
  expect(onRequestSpace).toHaveBeenCalledTimes(2);
});
it('does not request scrolling when the suggestions fit', () => {
  const onRequestSpace = jest.fn();
  renderHook(() =>
    useAddressSuggestionsSpace({
      predictions: [
        {
          placeId: 'one',
          description: 'Test street',
          mainText: 'Test street',
          secondaryText: 'Lagos',
        },
      ],
      anchor: { x: 26, y: 200, width: 340, height: 52 },
      host: { x: 10, y: 100, width: 380, height: 700 },
      keyboardTop: 600,
      contentHeight: 128,
      onRequestSpace,
    })
  );
  expect(onRequestSpace).not.toHaveBeenCalled();
});
