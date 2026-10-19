# Baci Mobile Admin

**Merchant app for order fulfillment and inventory management**

Part of the Baci Multi-Tenant E-commerce Platform.

## Overview

The Baci Mobile Admin is a React Native application built with Expo, designed specifically for merchants to manage their stores on-the-go. It provides powerful tools for order fulfillment, inventory management, and business analytics.

## Architecture

### The Engine (Data Layer)
- **MMKV**: High-performance storage for instant data access
- **TanStack Query**: Smart caching with offline-first support
- **Persistence**: Query results cached for 12 hours with automatic invalidation

### The Brain (Backend)
- **Supabase**: Real-time database and authentication
- **Edge Functions**: Serverless business logic
- **Row-Level Security**: Multi-tenant data isolation

## Features

### Order Management
- Real-time order tracking
- Status updates (pending → processing → shipped → delivered)
- Customer information and shipping details
- Order filtering and search

### Inventory Control
- Product catalog management
- Stock level tracking with alerts
- Barcode scanning for quick updates
- SKU-based search

### Analytics Dashboard
- Revenue tracking
- Top-selling products
- Customer metrics
- Performance insights

### Settings & Configuration
- Store profile management
- Business hours configuration
- Notification preferences
- Team member management

## Tech Stack

- **Framework**: Expo 57 + React Native 0.86
- **Language**: TypeScript 6.0
- **Navigation**: Expo Router (file-based routing)
- **State Management**: Zustand + TanStack Query
- **Storage**: MMKV (fastest React Native storage)
- **Authentication**: Supabase Auth
- **UI**: Custom components with Ionicons

## Project Structure

```
baci-mobile-admin/
├── app/                    # Expo Router pages
│   ├── (tabs)/            # Tab navigator screens
│   │   ├── index.tsx      # Orders screen
│   │   ├── inventory.tsx  # Inventory management
│   │   ├── analytics.tsx  # Business analytics
│   │   └── settings.tsx   # App settings
│   ├── order/[id].tsx     # Order details
│   ├── product/[id].tsx   # Product editor
│   ├── scan.tsx           # Barcode scanner
│   └── _layout.tsx        # Root layout
├── lib/                   # Core libraries
│   ├── query-client.ts    # TanStack Query setup
│   ├── supabase.ts        # Supabase client
│   └── QueryProvider.tsx  # Query provider wrapper
├── hooks/                 # Custom hooks
│   └── useColorScheme.ts  # Theme detection
├── assets/               # Images and static files
└── app.json             # Expo configuration

## Getting Started

### Prerequisites
- Node.js 24.x (the version required by the workspace)
- pnpm 11.7.0 via Corepack (do not use npm or Yarn)
- Expo CLI
- iOS Simulator (Mac) or Android Emulator

### Installation

```bash
# Install dependencies
pnpm install

# Start the development server
pnpm start

# Run on iOS
pnpm ios

# Run on Android
pnpm android
```

### Environment Setup

Create a `.env` file (not committed to git):

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
# Temporary fallback through 2026 only:
# EXPO_PUBLIC_SUPABASE_ANON_KEY=your_legacy_supabase_anon_key
```

### Android Emulator QA

Use the checked-in launcher for Android QA:

```bash
pnpm --filter baci-mobile-admin android:emulator
```

This is the only supported emulator launch path for agents and automation. Do
not launch the mobile-admin emulator directly with `-gpu swiftshader_indirect`.
The launcher owns GPU mode, Quick Boot, restarts ADB, waits for boot, disables
unused radio services, registers the Metro ADB reverse on port 8081, waits for
Android load to settle, and fails if `adb shell` is not responsive.
By default it launches `Baci_Pixel_9_Pro_XL_API_36_Google`, an Android 16 API 36
Google APIs arm64 AVD using the Pixel 9 Pro XL device profile. The launcher uses
emulator GPU mode `auto`, 2 CPU cores, and 4096 MB RAM. API 36 ATD images are
not exposed by the current command-line SDK catalog on this host, and API 36.1
Google APIs hung during install verification, so do not downgrade the default to
API 35 ATD or switch to API 36.1 without a passing scripted launch and install smoke.
Use `BACI_ANDROID_AVD_NAME` only for an explicit fallback during
emulator-infrastructure triage.
Set `BACI_ANDROID_COLD_BOOT=1` only when a fresh emulator state is required.

Build and install the debug APK with:

```bash
cd apps/mobile-admin/android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
cd ../../..
pnpm --filter baci-mobile-admin android:install
```

Do not use Gradle `installDebug` for emulator QA on this host; Android 16 ADB
install is stable with the repo `--no-streaming` installer, while Gradle's
device property fetcher can time out.

Run Metro for Android with:

```bash
pnpm --filter baci-mobile-admin android:metro
```

Do not use a localhost-only Metro host for emulator QA; the dev client connects
through `10.0.2.2`.

Launch the Android dev client with:

```bash
pnpm --filter baci-mobile-admin android:launch
```

Do not use raw `adb shell am start` commands for mobile-admin QA. The launcher
owns the Metro reverse, settled-load check, package force-stop, and Expo
dev-client URL.

### Simulator and Emulator Keyboards

If an input focuses but the on-screen keyboard does not appear, treat that as a simulator or emulator setting first.

- iOS Simulator:
  - Turn off `Hardware > Keyboard > Connect Hardware Keyboard` when you need the software keyboard.
  - Use `Cmd-K` to toggle the on-screen keyboard.
- Android Emulator:
  - Enable the virtual keyboard when a hardware keyboard is attached.
  - Typical path: `Settings > System > Languages & input > Physical keyboard > Show virtual keyboard`.

This is a simulator or emulator configuration issue unless `TextInput` focus itself is failing.

### Firebase iOS Config

`GoogleService-Info.plist` is intentionally tracked for the admin app. Firebase client
configuration is bundled into the shipped iOS binary anyway, and Xcode Cloud requires a
deterministic plist at checkout time to archive successfully. The tracked plist must only
contain standard client-side Firebase identifiers such as bundle ID, app ID, project ID,
OAuth client IDs, and the restricted mobile API key. Do not commit Firebase Admin SDK
keys, service account JSON, or any other server-side credentials. Android Firebase config
stays secret-backed in CI.

## Development Guidelines

### Code Standards
- TypeScript strict mode enabled
- Functional components with hooks
- Descriptive component and variable names
- Comments for complex business logic

### Performance Principles
- MMKV for all local storage (10x faster than AsyncStorage)
- TanStack Query for smart data fetching and caching
- Offline-first architecture with automatic retry
- FlashList for long scrollable lists

### UI/UX Guidelines
- Professional admin theme (dark slate + blue accent)
- Consistent spacing and typography
- Clear status indicators and feedback
- Touch-friendly controls (min 44px tap targets)

## Multi-Tenant Architecture

This admin app shares the same backend infrastructure with:
- **baci-web-platform**: The main merchant dashboard (web)
- **baci-mobile-storefront**: Customer-facing mobile app

All apps use the same:
- Supabase database with RLS policies
- Edge Functions for business logic
- Shared data models and validation (Zod schemas)

### EAS Update and release policy

The admin app has a production OTA foundation, but local development remains
Metro/dev-client based. Run `pnpm start` (or
`pnpm --filter baci-mobile-admin android:metro` for the checked-in LAN Android
workflow); these commands do not publish updates or consume the EAS Update
service.

Release builds are isolated by channel:

- `preview` builds receive only the `preview` channel.
- `production` builds receive only the `production` channel.
- The `development` profile intentionally has no update channel; Metro is the
  intended JavaScript source for local development.

Runtime compatibility uses the concrete semantic app-version string required by
the checked-in bare native projects. The release workflows inject the store
version into `APP_VERSION`/`IOS_APP_VERSION`, so every store release gets a
deterministic runtime without depending on release-only native files or secrets.
When publishing an update, provide the same app version that is embedded in the
target binary; never publish from a checkout that falls back to `2.0.1`. Release
updates use `ON_LOAD` with a zero-millisecond fallback timeout: the embedded or
already-cached bundle starts immediately, while a compatible download is applied
on the next restart. Hermes bytecode diff support is enabled to reduce subsequent
update downloads.

Publishing is an owner-approved release action. Before publishing to
`production`, validate the same update on a preview build, confirm the target
app version and channel, and record a rollback plan. Never publish from a Metro
session or commit credentials to this repository.

## Key Differences from Storefront

While the admin app uses the same "Engine" and "Brain" as the storefront:

1. **Shorter cache time**: 2 minutes stale time vs 5 minutes (admin needs fresher data)
2. **Admin theme**: Professional dark slate vs customer-friendly colors
3. **Different permissions**: Admin RLS policies vs customer policies
4. **Barcode scanning**: Integrated for inventory management
5. **Order management**: Full CRUD vs read-only order history

## Roadmap

- [ ] Real-time order notifications with push
- [ ] Bulk inventory updates via CSV
- [ ] Advanced analytics with charts
- [ ] Thermal printer integration
- [ ] Team member role management
- [ ] Multi-language support

## Related Projects

- [baci-web-platform](../baci-web-platform) - Main web dashboard
- [baci-mobile-storefront](../baci-mobile-storefront) - Customer mobile app

## License

Proprietary - Baci Platform
