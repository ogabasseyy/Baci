import { expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { runSavingsGoalSubmission } from './run-savings-goal-submission';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { createInput } from './use-start-savings-submit.test-utils';

jest.mock('./run-savings-goal-submission', () => ({
  runSavingsGoalSubmission: jest.fn(),
}));
jest.mock('./run-savings-card-authorization', () => ({
  runSavingsCardAuthorization: jest.fn(),
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));

it('requires a selected product before submitting', async () => {
  jest.clearAllMocks();
  const input = createInput({ selectedProduct: null });
  const { result } = renderHook(() => useStartSavingsSubmit(input));

  await act(async () => {
    await result.current.submitSavingsGoal();
  });

  expect(input.setFormError).toHaveBeenCalledWith(
    'Select a product to save for.'
  );
  expect(runSavingsGoalSubmission).not.toHaveBeenCalled();
});

it.each([
  'requiresVariantSelection',
  'variantId',
])('blocks direct submission when %s is missing', async (field) => {
  jest.clearAllMocks();
  const input = createInput();
  Reflect.deleteProperty(input.selectedProduct, field);
  const { result } = renderHook(() => useStartSavingsSubmit(input));

  await act(async () => {
    await result.current.submitSavingsGoal();
  });

  expect(input.setFormError).toHaveBeenCalledWith(
    'Select the exact device variant you want to save for.'
  );
  expect(runSavingsGoalSubmission).not.toHaveBeenCalled();
});
