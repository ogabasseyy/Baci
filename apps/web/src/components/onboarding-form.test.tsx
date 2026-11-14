import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Module Mocks (hoisted before all imports) ---

const mockFormAction = vi.fn();
const mockToast = vi.fn();
const mockPush = vi.fn();

vi.mock('@/app/(platform)/onboarding/actions', () => ({
  submitOnboarding: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    const Stub = () => null;
    Stub.displayName = 'DynamicStub';
    return Stub;
  },
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/analytics/platform-analytics-provider', () => ({
  trackMerchantSignupStarted: vi.fn(),
  trackMerchantSignupCompleted: vi.fn(),
}));

vi.mock('@/components/logo', () => ({
  Logo: () => <div data-testid="logo">Logo</div>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
    name,
  }: {
    children: React.ReactNode;
    onValueChange: (value: string) => void;
    value: string;
    name?: string;
  }) => (
    // Native <select> preserves combobox semantics while still exercising
    // the react-hook-form onValueChange path in this unit test.
    <div>
      <select
        aria-label={name === 'businessType' ? 'Business type' : name}
        name={name}
        value={value || ''}
        onChange={(e) => onValueChange(e.target.value)}
      >
        <option value="">Select type</option>
        {children}
      </select>
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({ value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{value}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock('@/components/ui/typing-placeholder-input', () => ({
  TypingPlaceholderInput: ({
    value,
    onChange,
    onKeyDown,
    name,
    staticPrefix: _staticPrefix,
    placeholders: _placeholders,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & {
    staticPrefix?: string;
    placeholders?: string[];
  }) => (
    <input
      data-testid={name}
      aria-label={
        name === 'businessName'
          ? 'Business name'
          : name === 'otherBusinessType'
            ? 'Please specify'
            : undefined
      }
      name={name}
      value={value as string}
      onChange={onChange}
      onKeyDown={onKeyDown}
      {...props}
    />
  ),
}));

vi.mock('@/components/onboarding/steps/step2-branding', () => ({
  default: () => <div data-testid="step2">Step 2 Content</div>,
}));

vi.mock('@/components/onboarding/steps/step3-account', () => ({
  default: () => <div data-testid="step3">Step 3 Content</div>,
}));

vi.mock('@/components/ui/bag-loader', () => ({
  BagLoader: () => <div data-testid="bag-loader" />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    children: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/progress', () => ({
  Progress: (props: { value: number; 'aria-label'?: string }) => (
    <progress aria-label={props['aria-label']} max={100} value={props.value} />
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => (
    <h5>{children}</h5>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: null }, error: null }),
    },
  }),
}));

vi.mock('@/store/onboarding-ui-store', () => ({
  useOnboardingUIStore: () => null,
}));

vi.mock('./onboarding-puck-preview', () => ({
  OnboardingPuckPreview: () => <div data-testid="puck-preview" />,
}));

// Mock useActionState and useTransition from React
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () =>
      [{ message: '', success: false }, mockFormAction, false] as const,
    useTransition: () => [false, (fn: () => void) => fn()] as const,
  };
});

// --- Import after all mocks ---
import OnboardingForm from './onboarding-form';

describe('OnboardingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders the welcome heading', () => {
    render(<OnboardingForm />);
    expect(
      screen.getByRole('heading', { name: /welcome to baci/i })
    ).toBeInTheDocument();
  });

  it('renders step 1 content initially', () => {
    render(<OnboardingForm />);
    expect(
      screen.getByText(/what's the nature of your business/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/what is your business name/i)).toBeInTheDocument();
    expect(screen.queryByTestId('step2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step3')).not.toBeInTheDocument();
  });

  it('shows step indicator with "Step 1 of 3"', () => {
    render(<OnboardingForm />);
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('shows progress bar with aria-label', () => {
    render(<OnboardingForm />);
    expect(
      screen.getByRole('progressbar', { name: /onboarding progress/i })
    ).toBeInTheDocument();
  });

  it('shows Next button on step 1', () => {
    render(<OnboardingForm />);
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('does not show Previous button on step 1', () => {
    render(<OnboardingForm />);
    expect(
      screen.queryByRole('button', { name: /previous/i })
    ).not.toBeInTheDocument();
  });

  it('shows the logo', () => {
    render(<OnboardingForm />);
    expect(screen.getByTestId('logo')).toBeInTheDocument();
  });

  it('shows "Already have an account?" link to login', () => {
    render(<OnboardingForm />);
    const link = screen.getByRole('link', { name: /log in/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/login');
  });

  it('renders the form with correct aria-label', () => {
    render(<OnboardingForm />);
    expect(
      screen.getByRole('form', { name: /store onboarding form/i })
    ).toBeInTheDocument();
  });

  it('clears step 1 validation errors when the user fixes the inputs', async () => {
    const user = userEvent.setup();

    render(<OnboardingForm />);

    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(
      screen.getByText('Please select a business type.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Business name must be at least 2 characters.')
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: /business type/i }),
      'electronics'
    );
    await user.type(
      screen.getByRole('textbox', { name: /business name/i }),
      'Audit Store'
    );

    await waitFor(() => {
      expect(
        screen.queryByText('Please select a business type.')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Business name must be at least 2 characters.')
      ).not.toBeInTheDocument();
    });
  });

  it('does not run step validation when Enter confirms IME composition', async () => {
    render(<OnboardingForm />);

    const nameInput = screen.getByRole('textbox', { name: /business name/i });

    expect(
      fireEvent.keyDown(nameInput, { key: 'Enter', isComposing: true })
    ).toBe(false);
    expect(fireEvent.keyDown(nameInput, { key: 'Enter', keyCode: 229 })).toBe(
      false
    );
    // Give a (wrongly) triggered async validation a chance to surface.
    await act(async () => {});
    expect(
      screen.queryByText('Please select a business type.')
    ).not.toBeInTheDocument();

    // A plain Enter advances via handleNext, which validates step 1.
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    expect(
      await screen.findByText('Please select a business type.')
    ).toBeInTheDocument();
  });
});
