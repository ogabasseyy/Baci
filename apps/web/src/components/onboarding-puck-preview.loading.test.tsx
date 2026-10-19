import type { Data } from '@puckeditor/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewGeneration = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/components/onboarding-preview/onboarding-preview-data', () => ({
  generatePreviewTemplate: previewGeneration.generate,
}));
vi.mock('@puckeditor/core', () => ({
  Render: ({ data }: { data: Data }) => (
    <div data-testid="puck-render">{JSON.stringify(data)}</div>
  ),
}));
vi.mock('@/components/builder/config', () => ({ builderConfig: {} }));
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));
vi.mock('@/hooks/use-cart', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { OnboardingPuckPreview } from './onboarding-puck-preview';

const colors = { primary: '#14532d', background: '#fff7ed', accent: '#f97316' };
const dataFor = (name: string): Data => ({
  content: [
    { type: 'Header', props: { id: `${name}-header`, storeName: name } },
  ],
  root: { props: { title: name } },
  zones: {},
});
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe('OnboardingPuckPreview generation state', () => {
  beforeEach(() => {
    previewGeneration.generate.mockReset();
  });

  it('keeps external data interactive without starting generation', () => {
    const onEdit = vi.fn();
    previewGeneration.generate.mockReturnValue(new Promise<Data>(() => {}));
    render(
      <OnboardingPuckPreview
        businessName="External Store"
        businessType="fashion"
        logoDataUri="data:image/png;base64,external"
        brandColors={colors}
        data={dataFor('External Store')}
        onEdit={onEdit}
      />
    );

    expect(previewGeneration.generate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('status', { name: /loading store preview/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /edit template/i })
    ).toBeInTheDocument();
  });

  it('shows a named loading status instead of the fallback while initial generation is unresolved', async () => {
    const initial = deferred<Data>();
    previewGeneration.generate.mockReturnValueOnce(initial.promise);
    render(
      <OnboardingPuckPreview
        businessName="Loading Store"
        businessType="fashion"
        logoDataUri="data:image/png;base64,loading"
        brandColors={colors}
      />
    );

    expect(
      screen.getByRole('status', { name: /loading store preview/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/your store preview will appear here/i)
    ).not.toBeInTheDocument();

    await act(async () => initial.resolve(dataFor('Loading Store')));
    await screen.findByText(/loading store-header/i);
    expect(
      screen.queryByRole('status', { name: /loading store preview/i })
    ).not.toBeInTheDocument();
  });

  it('keeps the displayed page behind a loading overlay until the latest input result arrives', async () => {
    const second = deferred<Data>();
    const third = deferred<Data>();
    previewGeneration.generate
      .mockResolvedValueOnce(dataFor('First Store'))
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const { rerender } = render(
      <OnboardingPuckPreview
        businessName="First Store"
        businessType="fashion"
        logoDataUri="data:image/png;base64,first"
        brandColors={colors}
      />
    );

    await screen.findByText(/first store-header/i);
    rerender(
      <OnboardingPuckPreview
        businessName="Second Store"
        businessType="fashion"
        logoDataUri="data:image/png;base64,second"
        brandColors={colors}
      />
    );
    expect(screen.getByText(/first store-header/i)).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: /loading store preview/i })
    ).toBeInTheDocument();

    rerender(
      <OnboardingPuckPreview
        businessName="Third Store"
        businessType="electronics"
        logoDataUri="data:image/png;base64,third"
        brandColors={colors}
      />
    );
    await act(async () => second.resolve(dataFor('Second Store')));
    expect(screen.queryByText(/second store-header/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: /loading store preview/i })
    ).toBeInTheDocument();

    await act(async () => third.resolve(dataFor('Third Store')));
    await waitFor(() =>
      expect(screen.getByText(/third store-header/i)).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('status', { name: /loading store preview/i })
    ).not.toBeInTheDocument();
  });

  it('falls back after template generation rejects', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    previewGeneration.generate.mockRejectedValueOnce(
      new Error('Generation failed')
    );

    render(
      <OnboardingPuckPreview
        businessName="Failed Store"
        businessType="fashion"
        logoDataUri="data:image/png;base64,failed"
        brandColors={colors}
      />
    );

    await waitFor(() => expect(errorSpy).toHaveBeenCalledOnce());
    expect(
      screen.getByText(/your store preview will appear here/i)
    ).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});
