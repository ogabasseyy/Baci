import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  connection: vi.fn(async () => {}),
  readOrigins: vi.fn(() => ({
    hosted: ['https://selfie.example.test', 'https://hosted.example.test'],
    selfie: ['https://selfie.example.test'],
  })),
}));
vi.mock('next/server', () => ({ connection: m.connection }));
vi.mock('@/components/payments/oxygen/OxygenPhoneContinuation', () => ({
  OxygenPhoneContinuation: ({ selfieOrigins }: { selfieOrigins: string[] }) => (
    <p data-origins={selfieOrigins.join(',')}>Continue verification</p>
  ),
}));
vi.mock('@/lib/payments/oxygen/oxygen-hosted-origins', () => ({
  readOxygenHostedOrigins: m.readOrigins,
}));

import { SelfieContinuation } from './SelfieContinuation';

it('reads the selfie origin configuration at request time', async () => {
  m.connection.mockClear();
  m.readOrigins.mockReturnValueOnce({
    hosted: ['https://first.example.test', 'https://first-hosted.example.test'],
    selfie: ['https://first.example.test'],
  });
  const first = await SelfieContinuation();
  const second = await SelfieContinuation();
  expect(m.connection).toHaveBeenCalledTimes(2);
  expect(first.props.selfieOrigins).toEqual(['https://first.example.test']);
  expect(second.props.selfieOrigins).toEqual(['https://selfie.example.test']);
});

it('renders the phone continuation with the selfie origins', async () => {
  render(await SelfieContinuation());
  expect(screen.getByText('Continue verification')).toHaveAttribute(
    'data-origins',
    'https://selfie.example.test'
  );
});

it('reads origins only after connection() resolves', async () => {
  let release: () => void = () => {};
  m.connection.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  m.readOrigins.mockClear();
  const pending = SelfieContinuation();
  await Promise.resolve();
  expect(m.readOrigins).not.toHaveBeenCalled();
  release();
  await pending;
  expect(m.readOrigins).toHaveBeenCalledTimes(1);
});
