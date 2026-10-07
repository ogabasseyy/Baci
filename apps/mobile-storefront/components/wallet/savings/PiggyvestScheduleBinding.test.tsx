import {
  piggyvestSavingsScreenSchema,
  type piggyvestScheduleReviewSchemas as schemas,
} from '@baci/shared/contracts';
import { createPiggyvestScheduleController } from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  PiggyvestScheduleBinding,
  type PiggyvestScheduleBindingInput,
} from './PiggyvestScheduleBinding';

it('fails closed on a malformed present native binding', () => {
  render(
    <PiggyvestScheduleBinding
      source={null}
      binding={{} as PiggyvestScheduleBindingInput}
    />
  );
  expect(screen.getByText('Schedule review unavailable.')).toBeTruthy();
});

it('rejects a retained native resume callback after the displayed version advances', async () => {
  const data = await fixture();
  render(<PiggyvestScheduleBinding {...data} />);
  fireEvent.press(screen.getByRole('checkbox'));
  let button: ReturnType<typeof screen.getByRole> | null = screen.getByRole(
    'button',
    { name: 'Save resume proposal' }
  );
  while (button && typeof button.props.onPress !== 'function')
    button = button.parent;
  const retained = button?.props.onPress;
  expect(typeof retained).toBe('function');
  await act(async () => {
    await data.binding.pause();
  });
  const writes = data.submit.mock.calls.length;
  await act(async () => {
    retained();
    await Promise.resolve();
  });
  expect(data.submit).toHaveBeenCalledTimes(writes);
});

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

async function fixture() {
  const goalId = '11111111-1111-4111-8111-111111111111';
  const source = piggyvestSavingsScreenSchema.parse({
    environment: 'staging',
    status: 'ready',
    sessionKey: 'native',
    goalId,
    policy: {
      status: 'draft',
      goalId,
      revisionId: goalId,
      device: { productName: 'Synthetic', variant: null, condition: 'New' },
      terms: {
        version: 'synthetic',
        hash: 'a'.repeat(64),
        text: '<b>Plain terms</b>',
      },
      consent: 'accepted',
    },
    eligibility: { status: 'blocked' },
    funding: { status: 'unavailable' },
    progress: { status: 'unavailable' },
  });
  let state: ReturnType<typeof schemas.state.parse> = {
    version: 0,
    status: 'paused',
    consentProposal: null,
  };
  let sequence = 0;
  const submit = jest.fn(
    async (request: ReturnType<typeof schemas.request.parse>) => {
      const command = request.command;
      state = {
        version: state.version + 1,
        status:
          command.action === 'request_resume' ? 'resume_proposed' : 'paused',
        consentProposal:
          command.action === 'request_resume'
            ? {
                operationId: request.operationId,
                revisionId: command.revisionId,
                termsHash: command.termsHash,
              }
            : null,
      };
      return {
        status: 'persisted_proposal',
        goalId,
        dispatch: 'disabled',
        debitPermission: false,
        receipt: {
          operationId: request.operationId,
          persisted: true,
          dispatch: 'disabled',
          debitPermission: false,
          state,
        },
      };
    }
  );
  const binding = createPiggyvestScheduleController({
    source,
    tenantKey: 'tenant',
    isCurrent: () => true,
    nextOperationId: () =>
      `22222222-2222-4222-8222-${String(++sequence).padStart(12, '0')}`,
    submit,
    read: async () => ({
      goalId,
      status: 'available',
      revisionId: goalId,
      termsHash: 'a'.repeat(64),
      state,
      historical: null,
      dispatch: 'disabled',
      debitPermission: false,
    }),
  });
  await binding.refresh();
  return { source, binding, submit };
}
it('requires native explicit consent and displays plain terms without active collection claims', async () => {
  const data = await fixture();
  render(<PiggyvestScheduleBinding {...data} />);
  expect(screen.getByText('<b>Plain terms</b>')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Save resume proposal' })
  ).toBeDisabled();
  fireEvent.press(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Save resume proposal' })
    );
  });
  expect(
    screen.getByText(/Last recorded proposal: resume_proposed/)
  ).toBeTruthy();
  expect(screen.getByRole('checkbox')).toHaveAccessibilityState({
    checked: false,
  });
});
it('blocks retained native action under live incompatibility and source replacement', async () => {
  const data = await fixture();
  let compatible = true;
  const view = render(
    <PiggyvestScheduleBinding {...data} isCompatible={() => compatible} />
  );
  fireEvent.press(screen.getByRole('checkbox'));
  compatible = false;
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Save resume proposal' })
    );
  });
  expect(data.submit).toHaveBeenCalledTimes(1);
  view.rerender(
    <PiggyvestScheduleBinding source={null} binding={data.binding} />
  );
  expect(screen.getByText('Schedule review unavailable.')).toBeTruthy();
  await expect(data.binding.pause()).rejects.toThrow();
});
