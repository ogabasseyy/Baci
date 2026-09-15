# CLAUDE.md - Baci Codebase Guide

## Storefront visual/performance verification

Before changing storefront layout, CSS delivery, hero loading or resource hints,
read `docs/perf/storefront-visual-regression.md` from the repository root.
It defines the sitespeed.io/Browsertime video, Lighthouse and console/network
checks, route coverage, local CDN pitfalls and evidence needed for a performance
claim. A high score with broken images is not a valid pass. Use
`pnpm --filter @baci/web perf:storefront:validate <report.json>` for the report
validity subset; video review remains separate.

## Project Overview

**Baci** is an AI-native e-commerce builder platform ("Your business, live in 3 minutes"). It enables merchants to create complete e-commerce stores rapidly using Google Gemini for logo analysis, product description generation, and store auto-configuration.

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16.0.7 (App Router) |
| Language | TypeScript 6.0.3 (strict mode) |
| UI | React 19 + shadcn/ui + Radix UI |
| Styling | Tailwind CSS 4.x (v4.3.0) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| State | React Context + Zustand |
| Forms | React Hook Form + Zod |
| AI | Google Gemini (2.0 Flash, 2.5 Flash Image, Imagen 3) |
| Payments | Korapay, Paystack, Kuda, Credit Direct |
| Email | ZeptoMail + React Email |
| Shipping | GIGL, Topship, Shiip |
| Analytics | GA4, Facebook CAPI, TikTok, Snapchat |

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (merchant)/         # Merchant routes (grouped)
│   ├── (storefront)/       # Storefront routes (grouped)
│   ├── api/                # API route handlers
│   ├── auth/               # Auth pages
│   ├── builder/            # Store builder
│   ├── dashboard/          # Merchant dashboard
│   ├── onboarding/         # Onboarding flow
│   └── [slug]/             # Dynamic storefront
├── ai/                     # AI integrations & flows
├── components/
│   ├── ui/                 # Base UI (shadcn)
│   ├── themed/             # Merchant themed components
│   ├── storefront/         # Customer-facing components
│   ├── builder/            # Builder components
│   └── dashboard/          # Dashboard components
├── contexts/               # React Context providers
├── hooks/                  # Custom hooks
├── lib/                    # Utilities & helpers
│   ├── supabase/           # Supabase clients (client, server, admin)
│   └── shipping/           # Shipping integrations
├── store/                  # Zustand stores
├── types/                  # TypeScript types
├── schemas/                # Zod validation schemas
├── config/                 # App configuration
└── templates/              # Store templates
```

## Common Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # Biome linting
npm run format       # Code formatting
npm run typecheck    # TypeScript check
npm run test         # Run tests
npm run analyze      # Bundle analysis
```

## Key Patterns

### Server vs Client Components

- Use Server Components for data fetching
- Add `'use client'` only when needed (hooks, interactivity)
- Pass server data to client components as props

### API Route Pattern

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  // Validate with Zod schema
  // Process request
  return NextResponse.json(data);
}
```

### Supabase Usage

```typescript
// Server-side (API routes, Server Components)
import { createClient } from '@/lib/supabase/server';
const supabase = await createClient();

// Client-side (Client Components)
import { createClient } from '@/lib/supabase/client';
const supabase = createClient();

// Admin operations (service role)
import { createClient } from '@/lib/supabase/admin';
const supabase = createClient();
```

### Form Pattern (React Hook Form + Zod)

```typescript
const schema = z.object({
  email: z.email(),
  name: z.string().min(1),
});

type FormData = z.infer<typeof schema>;

const form = useForm<FormData>({
  resolver: zodResolver(schema),
});
```

### Context Pattern

```typescript
// Provider setup in contexts/
export const MyContext = createContext<Type | undefined>(undefined);

export function MyProvider({ children }: { children: ReactNode }) {
  // State and logic
  return <MyContext.Provider value={value}>{children}</MyContext.Provider>;
}

export function useMyContext() {
  const context = useContext(MyContext);
  if (!context) throw new Error('Must be used within MyProvider');
  return context;
}
```

## Key Contexts

- `AuthContext` - User authentication state
- `ProductContext` - Product catalog management
- `StorefrontContext` - Storefront data
- `CustomerAuthContext` - Customer auth (separate from merchant)

## Key Hooks

- `useMerchant()` - Merchant data, permissions, staff
- `useCart()` - Shopping cart state
- `useAuth()` - Authentication state
- `useLoyalty()` - Loyalty program
- `useMerchantFeatures()` - Feature flags

## Security

### Middleware (middleware.ts)
- Rate limiting on API routes
- CSRF protection (token validation)
- Auth session refresh
- Custom domain routing

### Input Validation
- Zod schemas for all API inputs
- HTML sanitization utilities in `lib/sanitize*.ts`
- CSRF tokens for non-GET requests

## AI Integration

### Models Used
- `gemini-2.0-flash` - Fast text (descriptions, autofill)
- `gemini-2.5-flash-image` - Multimodal (image analysis)
- `imagen-3.0-generate-002` - Image generation

### Rate Limits (per-user)
- Builder: 10 req/min
- Product descriptions: 20 req/min
- Image generation: 5 req/min

### AI Code Location
- `src/ai/` - AI flows and provider config
- `src/services/` - Service implementations

## Database

- Supabase PostgreSQL with RLS (Row-Level Security)
- Migrations in `supabase/migrations/` (90+ files)
- Use Supabase client factories from `lib/supabase/`

## Environment Variables

### Required
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for admin operations)

### For Features
- `KORAPAY_SECRET_KEY` - Payments
- `ZEPTOMAIL_TOKEN` - Email
- `GOOGLE_GENAI_API_KEY` - AI features

## Code Quality

### Linting & Formatting
- **Biome** for linting and formatting (replaces ESLint/Prettier)
- Run `npm run lint` and `npm run format`

### TypeScript
- Strict mode enabled
- Path alias: `@/*` maps to `./src/*`

### Testing
- Jest + Vitest + React Testing Library
- Test files: `*.test.tsx` or `*.spec.tsx`

## Important Files

- `middleware.ts` - Request middleware (auth, rate limiting, domains)
- `src/env.ts` - Environment variable management
- `next.config.ts` - Next.js configuration
- `tailwind.config.mjs` - Tailwind theme config
- `biome.json` - Linter/formatter config

## API Routes Structure

```
/api/
├── admin/          # Admin endpoints
├── analytics/      # Analytics tracking
├── customers/      # Customer management
├── merchant/       # Merchant APIs
├── orders/         # Order processing
├── payments/       # Payment webhooks
├── products/       # Product CRUD
├── storefront/     # Public APIs
└── [40+ more]
```

## Common Gotchas

1. **Supabase Clients**: Use the correct client factory (server vs client vs admin)
2. **Auth Checks**: Always verify user auth before database operations
3. **Rate Limiting**: API routes are rate-limited in middleware
4. **CSRF**: Non-GET API requests require CSRF tokens
5. **Image Optimization**: Use Next.js Image component with proper sizes
6. **React Compiler**: Enabled - automatic memoization, avoid manual memo/useCallback unless needed

## Deployment

- Hosted on **Vercel**
- Auto-deploys from Git
- Cron jobs configured in `vercel.json`
- Database on Supabase (always-on PostgreSQL)
