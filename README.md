# Baci - Agent-Native Commerce Infrastructure

**"Your business, live in 3 minutes"**

Baci helps African merchants create complete ecommerce storefronts in under 3 minutes and makes those storefronts ready for AI agents to discover, trust, purchase from, and monitor. It combines AI-assisted store creation with agent-readable trust contracts, safe checkout actions, and merchant-facing operational recovery.

## 📚 Documentation

### Core Resources
- **[Capability and Agent Access Map](docs/product/agent-access-map.md)**: Start here to locate web/mobile workflows, reviewed capability evidence and actual connector/tool boundaries.
- **[Project Blueprint](project_brief.md)**: The master plan, product vision, and detailed requirements.
- **[Architecture Diagrams](docs/architecture/ARCHITECTURE_DIAGRAMS.md)**: Visual flows of the system.
- **[API Documentation](docs/api/README.md)**: Auto-generated API reference for the codebase.

### Developer Guides
- **[Testing Guide](docs/guides/TESTING_GUIDE.md)**: How to run and write tests.
- **[Migration Guide](docs/guides/MIGRATION_TESTING_GUIDE.md)**: Database and AI migration steps.
- **[Domain Setup](docs/guides/DOMAIN_SETUP.md)**: Configuring custom domains.

### Operations
- **[VPS Workers Runbook](docs/ops/vps-workers.md)**: Production background job schedules and manual cron fallbacks.

### AI System
- **[AI Context](docs/ai/AI_CONTEXT.md)**: Deep dive into the AI flows.
- **[Google AI Setup](docs/ai/GOOGLE_AI_SETUP.md)**: Configuring Gemini.
- **[Background Jobs](docs/ai/BACKGROUND_AI_JOBS.md)**: Worker architecture.
- **[Agent-Native Commerce Positioning](docs/superpowers/specs/2026-05-13-agent-native-commerce-positioning.md)**: YC-facing platform thesis and roadmap focus.

### Reports & Audits
- **[Security Audit 2025](docs/reports/SECURITY_AUDIT_2025.md)**
- **[Scalability Review](docs/reports/SCALABILITY_REVIEW.md)**

## 🚀 Getting Started

### Prerequisites
- Node.js 22+
- pnpm 10+ (`npm install -g pnpm`)
- Supabase CLI (for local backend)

### Installation

```bash
# Install dependencies (uses pnpm workspaces)
pnpm install

# Setup environment variables
cp apps/web/.env.example apps/web/.env.local
# (Fill in your Supabase and Google AI keys)
```

### Development

```bash
# Run the development server via Turborepo
pnpm turbo dev

# Or run just the web app
pnpm turbo dev --filter=@baci/web
```

### Common Commands

```bash
pnpm turbo build      # Build all apps
pnpm turbo lint       # Lint all apps
pnpm turbo typecheck  # Type check
pnpm turbo test       # Run tests
pnpm format           # Format code with Biome
```

## 📁 Monorepo Structure

```
Baci-app/
├── apps/
│   └── web/              # Main Next.js web platform (@baci/web)
├── packages/             # Shared packages (future)
├── docs/                 # Documentation
├── pnpm-workspace.yaml   # pnpm workspace config
├── turbo.json            # Turborepo pipeline config
└── package.json          # Root package.json
```

## 🛠️ Tech Stack

- **Frontend**: Next.js 16 (App Router), Tailwind CSS, shadcn/ui
- **Backend**: Supabase (Auth, Postgres, Storage)
- **AI**: Google Gemini 2.0/2.5 Flash + Imagen 3
- **Language**: TypeScript (strict mode)
- **Package Manager**: pnpm (workspaces)
- **Build System**: Turborepo
