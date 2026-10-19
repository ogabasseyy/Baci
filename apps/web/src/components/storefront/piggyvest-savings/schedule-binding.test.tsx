import { piggyvestSavingsScreenSchema } from '@baci/shared/contracts';
import { createPiggyvestScheduleController } from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { scheduleJourneyFixture } from '../../../../../../packages/shared/src/lib/piggyvest-schedule.test-support';
import { BoundScheduleReview, type ScheduleBinding } from './schedule-binding';

it('fails closed instead of crashing on a malformed present binding', () => {
  render(<BoundScheduleReview source={null} binding={{} as ScheduleBinding} />);
  expect(screen.getByRole('status')).toHaveTextContent('unavailable');
});

async function fixture() {
  const data = scheduleJourneyFixture();
  const binding = createPiggyvestScheduleController(data.options);
  await binding.refresh();
  return {
    ...data,
    binding,
    source: piggyvestSavingsScreenSchema.parse(data.source),
  };
}
it('renders plain terms and requires fresh explicit consent; never claims active collection', async () => {
  const data = await fixture();
  const view = render(
    <BoundScheduleReview source={data.source} binding={data.binding} />
  );
  expect(screen.getByText('<b>Synthetic plain terms</b>')).toBeVisible();
  expect(view.container.querySelector('b')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Save resume proposal' })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Save resume proposal' })
    );
  });
  expect(screen.getByRole('status')).toHaveTextContent('resume_proposed');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByText(/No automatic collection is enabled/)).toBeVisible();
});
it('blocks retained resume when another operation becomes incompatible before rerender', async () => {
  const data = await fixture();
  let compatible = true;
  render(
    <BoundScheduleReview
      source={data.source}
      binding={data.binding}
      isCompatible={() => compatible}
    />
  );
  fireEvent.click(screen.getByRole('checkbox'));
  compatible = false;
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Save resume proposal' })
    );
  });
  expect(data.submit).toHaveBeenCalledTimes(1);
});
it('resets consent on binding replacement and fails closed for null source', async () => {
  const data = await fixture();
  const view = render(
    <BoundScheduleReview source={data.source} binding={data.binding} />
  );
  fireEvent.click(screen.getByRole('checkbox'));
  const replacement = await fixture();
  view.rerender(
    <BoundScheduleReview
      source={replacement.source}
      binding={replacement.binding}
    />
  );
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  await expect(data.binding.requestResume(true, 1)).rejects.toThrow();
  view.rerender(
    <BoundScheduleReview source={null} binding={replacement.binding} />
  );
  expect(screen.getByRole('status')).toHaveTextContent('unavailable');
});
it('keeps failed pause uncertain until server readback, and keeps history separate', async () => {
  const data = await fixture();
  render(<BoundScheduleReview source={data.source} binding={data.binding} />);
  data.loseAcknowledgement();
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Pause schedule proposal' })
    );
  });
  expect(screen.getByRole('status')).toHaveTextContent('Outcome unconfirmed');
  expect(
    screen.getByRole('button', { name: 'Save resume proposal' })
  ).toBeDisabled();
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh schedule review' })
    );
  });
  expect(screen.getByText(/Historical receipt:/)).toHaveTextContent(
    'History only'
  );
});
