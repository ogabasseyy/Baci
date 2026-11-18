import { trackTransmission } from './track-transmission';

function setup() {
  const command = jest.fn((_id: string, input: string) =>
    Promise.resolve(`ok:${input}`)
  );
  return { command, tracker: trackTransmission({ command, other: 7 }) };
}

it('starts unsent and forwards the command with its result', async () => {
  const { command, tracker } = setup();
  expect(tracker.sent()).toBe(false);
  await expect(tracker.coordinator.command('cart', 'x')).resolves.toBe('ok:x');
  expect(command).toHaveBeenCalledWith('cart', 'x');
  expect(tracker.sent()).toBe(true);
  expect(tracker.coordinator.other).toBe(7);
});

it('clears on reset so the next edit starts unsent', async () => {
  const { tracker } = setup();
  await tracker.coordinator.command('cart', 'x');
  tracker.reset();
  expect(tracker.sent()).toBe(false);
});

it('counts a command that was attempted and then rejected', async () => {
  const { command, tracker } = setup();
  command.mockRejectedValueOnce(new Error('offline'));
  await expect(tracker.coordinator.command('cart', 'x')).rejects.toThrow(
    'offline'
  );
  expect(tracker.sent()).toBe(true);
});
