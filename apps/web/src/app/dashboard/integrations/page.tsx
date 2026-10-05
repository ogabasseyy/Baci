import { ArrowRight, Bot, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getMerchantForUser } from '@/lib/merchant-server';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';
import {
  getIntegrationStatus,
  type IntegrationStatusState,
} from './integration-status';

export const metadata = {
  title: 'Social Platforms | Baci',
  description:
    'Reach more customers and track them efficiently across social platforms.',
};

const integrations = [
  {
    id: 'muse',
    name: 'Muse',
    description:
      'Read-only AI access to orders, inventory, and analytics through a scoped, revocable grant.',
    href: '/dashboard/integrations/muse',
    icon: <Bot className="size-10 text-primary" aria-label="Muse" />,
    color: 'bg-primary/10',
  },
  {
    id: 'google-merchant',
    name: 'Google Merchant Center',
    description:
      'Sync your products to Google Shopping and run product ads across Google Search.',
    href: '/dashboard/integrations/google-merchant',
    // Official Google G Logo SVG
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="size-10"
        role="img"
        aria-label="Google logo"
      >
        <title>Google logo</title>
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
    ),
    color: 'bg-white border-slate-100',
  },
  {
    id: 'facebook',
    name: 'Facebook & Instagram',
    description:
      'Sell products directly on Facebook Shops and Instagram Shopping.',
    href: '/dashboard/integrations/facebook',
    // Official Facebook Logo (Circle)
    icon: (
      <svg
        className="size-10 text-[#1877F2]"
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
        aria-label="Facebook logo"
      >
        <title>Facebook logo</title>
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
    color: 'bg-[#F0F2F5] dark:bg-[#1877F2]/10',
  },
  {
    id: 'tiktok',
    name: 'TikTok Shopping',
    description:
      'Showcase products in videos and run shoppable ads to reach younger audiences.',
    href: '/dashboard/integrations/tiktok',
    // Official TikTok Logo
    icon: (
      <svg
        className="size-10 text-black dark:text-white"
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
        aria-label="TikTok logo"
      >
        <title>TikTok logo</title>
        <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743l-.002-.001.002.001a2.895 2.895 0 0 1 3.183-4.51v-3.5a6.329 6.329 0 0 0-5.394 10.692 6.341 6.341 0 0 0 10.857-4.424V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104z" />
      </svg>
    ),
    color: 'bg-black/5 dark:bg-white/10',
  },
  {
    id: 'snapchat',
    name: 'Snapchat',
    description:
      'Reach the Snapchat generation with dynamic product ads and tracking.',
    href: '/dashboard/integrations/snapchat',
    // Official Snapchat Ghost Logo
    icon: (
      <svg
        role="img"
        viewBox="0 0 515 515"
        className="size-8"
        aria-label="Snapchat"
      >
        <title>Snapchat</title>
        <path
          fill="#FFFC00"
          d="M0.2 383.734v.023c.308 11.424.403 22.914 2.33 34.268 2.042 12.012 4.961 23.725 10.53 34.627 7.529 14.756 17.869 27.217 30.921 37.396 9.371 7.309 19.608 13.111 30.94 16.771 16.524 5.33 33.571 7.373 50.867 7.473 10.791.068 21.575.338 32.37.293 78.395-.33 156.792.566 235.189-.484 10.403-.141 20.636-1.41 30.846-3.277 19.569-3.582 36.864-11.932 51.661-25.133 17.245-15.381 28.88-34.205 34.132-56.924 3.437-14.85 4.297-29.916 4.444-45.035v-3.016c0-1.17-.445-256.892-.486-260.272-.115-9.285-.799-18.5-2.54-27.636-2.117-11.133-5.108-21.981-10.439-32.053-5.629-10.641-12.68-20.209-21.401-28.57-13.359-12.81-28.775-21.869-46.722-26.661-16.21-4.327-32.747-5.285-49.405-5.27-.027-.004-.09-.173-.094-.255H131.207c-.005.086-.008.172-.014.255-9.454.173-18.922.102-28.328 1.268-10.304 1.281-20.509 3.21-30.262 6.812-15.362 5.682-28.709 14.532-40.11 26.347-12.917 13.386-22.022 28.867-26.853 46.894-4.31 16.084-5.248 32.488-5.271 49.008"
        />
        <path
          fill="#FFF"
          d="M259.648 434.201c-1.068 0-2.087-.039-2.862-.076-.615.053-1.25.076-1.886.076-22.437 0-37.439-10.607-50.678-19.973-9.489-6.703-18.438-13.031-28.922-14.775-5.149-.854-10.271-1.287-15.22-1.287-8.917 0-15.964 1.383-21.109 2.389-3.166.617-5.896 1.148-8.006 1.148-2.21 0-4.895-.49-6.014-4.311-.887-3.014-1.523-5.934-2.137-8.746-1.536-7.027-2.65-11.316-5.281-11.723-28.141-4.342-44.768-10.738-48.08-18.484-.347-.814-.541-1.633-.584-2.443-.129-2.309 1.501-4.334 3.777-4.711 22.348-3.68 42.219-15.492 59.064-35.119 13.049-15.195 19.457-29.713 20.145-31.316.03-.072.065-.148.101-.217 3.247-6.588 3.893-12.281 1.926-16.916-3.626-8.551-15.635-12.361-23.58-14.882-1.976-.625-3.845-1.217-5.334-1.808-7.043-2.782-18.626-8.66-17.083-16.773 1.124-5.916 8.949-10.036 15.273-10.036 1.756 0 3.312.308 4.622.923 7.146 3.348 13.575 5.045 19.104 5.045 6.876 0 10.197-2.618 11-3.362-.198-3.668-.44-7.546-.674-11.214 0-.004-.005-.048-.005-.048-1.614-25.675-3.627-57.627 4.546-75.95 24.462-54.847 76.339-59.112 91.651-59.112.408 0 6.674-.062 6.674-.062.283-.005.59-.009.908-.009 15.354 0 67.339 4.27 91.816 59.15 8.173 18.335 6.158 50.314 4.539 76.016l-.076 1.23c-.222 3.49-.427 6.793-.6 9.995.756.696 3.795 3.096 9.978 3.339 5.271-.202 11.328-1.891 17.998-5.014 2.062-.968 4.345-1.169 5.895-1.169 2.343 0 4.727.456 6.714 1.285l.106.041c5.66 2.009 9.367 6.024 9.447 10.242.071 3.932-2.851 9.809-17.223 15.485-1.472.583-3.35 1.179-5.334 1.808-7.952 2.524-19.951 6.332-23.577 14.878-1.97 4.635-1.322 10.326 1.926 16.912.036.072.067.145.102.221 1 2.344 25.205 57.535 79.209 66.432 2.275.379 3.908 2.406 3.778 4.711-.048.828-.248 1.656-.598 2.465-3.289 7.703-19.915 14.09-48.064 18.438-2.642.408-3.755 4.678-5.277 11.668-.63 2.887-1.271 5.717-2.146 8.691-.819 2.797-2.641 4.164-5.567 4.164h-.441c-1.905 0-4.604-.346-8.008-1.012-5.95-1.158-12.623-2.236-21.109-2.236-4.948 0-10.069.434-15.224 1.287-10.473 1.744-19.421 8.062-28.893 14.758-2.606 1.815-17.613 12.423-40.048 12.423"
        />
        <path
          fill="#020202"
          d="M260.983 84.948c14.455 0 64.231 3.883 87.688 56.472 7.724 17.317 5.744 48.686 4.156 73.885-.248 3.999-.494 7.875-.694 11.576l-.084 1.591 1.062 1.185c.429.476 4.444 4.672 13.374 5.017l.144.008.15-.003c5.904-.225 12.554-2.059 19.776-5.442 1.064-.498 2.48-.741 3.978-.741 1.707 0 3.521.321 5.017.951l.226.09c3.787 1.327 6.464 3.829 6.505 6.093.022 1.28-.935 5.891-14.359 11.194-1.312.518-3.039 1.069-5.041 1.7-8.736 2.774-21.934 6.96-26.376 17.427-2.501 5.896-1.816 12.854 2.034 20.678 1.584 3.697 26.52 59.865 82.631 69.111-.011.266-.079.557-.229.9-.951 2.24-6.996 9.979-44.612 15.783-5.886.902-7.328 7.5-9 15.17-.604 2.746-1.218 5.518-2.062 8.381-.258.865-.306.914-1.233.914-.128 0-.278 0-.442 0-1.668 0-4.2-.346-7.135-.922-5.345-1.041-12.647-2.318-21.982-2.318-5.21 0-10.577.453-15.962 1.352-11.511 1.914-20.872 8.535-30.786 15.543-13.314 9.408-27.075 19.143-48.071 19.143-.917 0-1.812-.031-2.709-.076l-.236-.01-.237.018c-.515.045-1.034.068-1.564.068-20.993 0-34.76-9.732-48.068-19.143-9.916-7.008-19.282-13.629-30.791-15.543-5.38-.896-10.752-1.352-15.959-1.352-9.333 0-16.644 1.428-21.978 2.471-2.935.574-5.476 1.066-7.139 1.066-1.362 0-1.388-.08-1.676-1.064-.844-2.865-1.461-5.703-2.062-8.445-1.676-7.678-3.119-14.312-9.002-15.215-37.613-5.809-43.659-13.561-44.613-15.795-.149-.352-.216-.652-.231-.918 56.11-9.238 81.041-65.408 82.63-69.119 3.857-7.818 4.541-14.775 2.032-20.678-4.442-10.461-17.638-14.653-26.368-17.422-2.007-.635-3.735-1.187-5.048-1.705-11.336-4.479-14.823-8.991-14.305-11.725.601-3.153 6.067-6.359 10.837-6.359 1.072 0 2.012.173 2.707.498 7.747 3.631 14.819 5.472 21.022 5.472 9.751 0 14.091-4.537 14.557-5.055l1.057-1.182-.085-1.583c-.197-3.699-.44-7.574-.696-11.565-1.583-25.205-3.563-56.553 4.158-73.871 23.37-52.396 72.903-56.435 87.525-56.435.36 0 6.717-.065 6.717-.065.292.001.581-.003.884-.003M260.983 75.91h-.017c-.333 0-.646 0-.944.004-2.376.024-6.282.062-6.633.066-8.566 0-25.705 1.21-44.115 9.336-10.526 4.643-19.994 10.921-28.14 18.66-9.712 9.221-17.624 20.59-23.512 33.796-8.623 19.336-6.576 51.905-4.932 78.078l.006.041c.176 2.803.361 5.73.53 8.582-1.265.581-3.316 1.194-6.339 1.194-4.864 0-10.648-1.555-17.187-4.619-1.924-.896-4.12-1.349-6.543-1.349-3.893 0-7.997 1.146-11.557 3.239-4.479 2.63-7.373 6.347-8.159 10.468-.518 2.726-.493 8.114 5.492 13.578 3.292 3.008 8.128 5.782 14.37 8.249 1.638.645 3.582 1.261 5.641 1.914 7.145 2.271 17.959 5.702 20.779 12.339 1.429 3.365.814 7.793-1.823 13.145-.069.146-.138.289-.201.439-.659 1.539-6.807 15.465-19.418 30.152-7.166 8.352-15.059 15.332-23.447 20.752-10.238 6.617-21.316 10.943-32.923 12.855-4.558.748-7.813 4.809-7.559 9.424.078 1.33.39 2.656.931 3.939.004.008.009.016.013.023 1.843 4.311 6.116 7.973 13.063 11.203 8.489 3.943 21.185 7.26 37.732 9.855.836 1.59 1.704 5.586 2.305 8.322.629 2.908 1.285 5.898 2.22 9.074 1.009 3.441 3.626 7.553 10.349 7.553 2.548 0 5.478-.574 8.871-1.232 4.969-.975 11.764-2.305 20.245-2.305 4.702 0 9.575.414 14.48 1.229 9.455 1.574 17.606 7.332 27.037 14 13.804 9.758 29.429 20.803 53.302 20.803.651 0 1.304-.021 1.949-.066.789.037 1.767.066 2.799.066 23.88 0 39.501-11.049 53.29-20.799l.022-.02c9.433-6.66 17.575-12.41 27.027-13.984 4.903-.814 9.775-1.229 14.479-1.229 8.102 0 14.517 1.033 20.245 2.15 3.738.736 6.643 1.09 8.872 1.09l.218.004h.226c4.917 0 8.53-2.699 9.909-7.422.916-3.109 1.57-6.029 2.215-8.986.562-2.564 1.46-6.674 2.296-8.281 16.558-2.6 29.249-5.91 37.739-9.852 6.931-3.215 11.199-6.873 13.053-11.166.556-1.287.881-2.621.954-3.979.261-4.607-2.999-8.676-7.56-9.424-51.585-8.502-74.824-61.506-75.785-63.758-.062-.148-.132-.295-.205-.438-2.637-5.354-3.246-9.777-1.816-13.148 2.814-6.631 13.621-10.062 20.771-12.332 2.07-.652 4.021-1.272 5.646-1.914 7.039-2.78 12.07-5.796 15.389-9.221 3.964-4.083 4.736-7.995 4.688-10.555-.121-6.194-4.856-11.698-12.388-14.393-2.544-1.052-5.445-1.607-8.399-1.607-2.011 0-4.989.276-7.808 1.592-6.035 2.824-11.441 4.368-16.082 4.588-2.468-.125-4.199-.66-5.32-1.171.141-2.416.297-4.898.458-7.486l.067-1.108c1.653-26.19 3.707-58.784-4.92-78.134-5.913-13.253-13.853-24.651-23.604-33.892-8.178-7.744-17.678-14.021-28.242-18.661-8.411-3.704-25.549-4.909-34.127-4.909"
        />
      </svg>
    ),
    color: 'bg-[#FFFC00] text-black border-none', // Snapchat Yellow background
  },
  {
    id: 'twitter',
    name: 'Twitter (X)',
    description: 'Track conversions and optimize ads with the X Pixel.',
    href: '/dashboard/integrations/twitter',
    // Official X Logo
    icon: (
      <svg
        className="size-9 text-black dark:text-white"
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
        aria-label="X (Twitter) logo"
      >
        <title>X (Twitter) logo</title>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    color: 'bg-black/5 dark:bg-white/10',
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics 4',
    description:
      'Track website traffic and user behavior with the latest Google Analytics.',
    href: '/dashboard/integrations/google-analytics',
    // Official GA4 Logo SVG
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="size-10"
        role="img"
        aria-label="Google Analytics logo"
      >
        <title>Google Analytics logo</title>
        <path d="M3.77 15.63H.89V19h2.88z" fill="#F9AB00" />
        <path d="M10.56 8.54H7.67V19h2.89z" fill="#E37400" />
        <path d="M17.33 4.29h-2.88V19h2.88z" fill="#E37400" />
      </svg>
    ),
    color: 'bg-orange-50 dark:bg-orange-900/10',
  },
];

const statusClassNames: Record<IntegrationStatusState, string> = {
  active:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  feed_ready: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  not_configured: 'border-muted-foreground/20 bg-muted text-muted-foreground',
  partial:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

export default async function SocialPlatformsPage() {
  const { merchant } = await getMerchantForUser();

  if (!merchant) {
    return redirect(asRoute('/login'));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-primary via-purple-500 to-blue-600 bg-clip-text text-transparent">
          Social Platforms
        </h1>
        <p className="text-muted-foreground mt-2">
          Reach more customers and track them efficiently across social
          platforms.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          // biome-ignore lint/suspicious/noExplicitAny: Complex Typed Route logic
          const href: any =
            'rawHref' in integration && integration.rawHref
              ? integration.href
              : asRoute(integration.href);
          const status = getIntegrationStatus(integration.id, merchant);

          return (
            <Card
              key={integration.id}
              aria-label={`${integration.name} integration`}
              className="group hover:shadow-lg transition-shadow bg-card hover:border-primary/50 relative overflow-hidden"
              role="article"
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div
                    className={`p-3 rounded-xl ${integration.color} flex items-center justify-center border border-transparent group-hover:scale-110 transition-transform duration-300`}
                  >
                    {integration.icon}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn('shrink-0', statusClassNames[status.state])}
                  >
                    {status.label}
                  </Badge>
                </div>
                <CardTitle className="mt-4">{integration.name}</CardTitle>
                <CardDescription className="line-clamp-2 mt-2">
                  {integration.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full group-hover:bg-primary/90">
                  <Link href={href}>
                    {status.actionLabel}
                    <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="glass border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center py-10">
          <div className="rounded-full bg-muted p-4 mb-4">
            <ShoppingBag className="size-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">More Coming Soon</h3>
          <p className="text-muted-foreground text-center max-w-md">
            We're working on integrations with more platforms including Amazon
            and Konga. Stay tuned for updates!
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
