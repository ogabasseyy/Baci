import { createClient } from '@/lib/supabase/client';

export interface CheckoutSignupAttempt {
  current: boolean;
}

interface SignUpCheckoutCustomerOptions {
  attempt: CheckoutSignupAttempt;
  enabled: boolean;
  hasUser: boolean;
  password: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  logSuccess?: boolean;
}

/** Sign up once per checkout attempt; account creation errors never block payment. */
export async function signUpCheckoutCustomer({
  attempt,
  enabled,
  hasUser,
  password,
  email,
  firstName,
  lastName,
  phone,
  logSuccess = false,
}: SignUpCheckoutCustomerOptions): Promise<void> {
  if (!enabled || hasUser || password.length < 6 || attempt.current) return;
  attempt.current = true;

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          phone,
          source: 'checkout',
          signup_type: 'customer',
        },
      },
    });
    if (error) {
      console.error('Silent signup background error');
    } else if (logSuccess) {
      console.log('Account created and session initialized');
    }
  } catch {
    console.error('Silent signup background error');
  }
}
