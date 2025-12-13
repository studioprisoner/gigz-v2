# Gigz V2

Transform Gigz from a manual logging tool into a living concert memory app.

## Quick Start

### 🚀 One-Command Setup

```bash
# Clone, install, and set up everything
git clone <your-repo> gigz-v2
cd gigz-v2
./setup-dev.sh
```

### 🎯 Start Development

```bash
# Start all services
bun run dev

# Or start individually
bun run dev:gateway    # API Gateway (http://localhost:3000)
bun run dev:auth       # Auth API (http://localhost:3001)
bun run dev:core       # Core API (http://localhost:3002)
```

### 📚 Documentation

- **[Local Development Guide](./LOCAL_DEVELOPMENT.md)** - Complete setup and testing guide
- **[CLAUDE.md](./CLAUDE.md)** - Project architecture and development guidelines

## Architecture

```
┌─────────────────────────────────────────┐
│               CLOUDFLARE                │
│        DNS │ DDoS │ CDN │ R2            │
└─────────────────────────────────────────┘
                      │
┌─────────────────────────────────────────┐
│            HETZNER INFRASTRUCTURE       │
│  ┌─────────────────────────────────────┐│
│  │        API Gateway (Bun)            ││
│  └─────────────────────────────────────┘│
│                      │                   │
│    ┌──────┬──────┬──────┬──────┬──────┐  │
│    ▼      ▼      ▼      ▼      ▼      │  │
│ ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐  │  │
│ │Auth││Core││Concert││Search││Workers│  │  │
│ │API ││API ││API ││API ││     ││     │  │  │
│ └────┘└────┘└────┘└────┘└────┘└────┘  │  │
│     │    │    │      │     │     │     │  │
│     └────┼────┴──────┴─────┼─────┘     │  │
│          ▼                 ▼           │  │
│   ┌───────────┐    ┌───────────┐       │  │
│   │PostgreSQL │    │ClickHouse │       │  │
│   └───────────┘    └───────────┘       │  │
│          ▼                 ▼           │  │
│   ┌───────────┐    ┌───────────┐       │  │
│   │   Redis   │    │Meilisearch│       │  │
│   └───────────┘    └───────────┘       │  │
└─────────────────────────────────────────┘
```

## Core Philosophy

**Your journal is yours first.** Social is a bonus, not the point.

**Shows find you** — stop typing, start confirming.

**Friends only** — no strangers, no followers, no algorithms.

**Simple** — you see your shows, you see your friends' shows.

## Tech Stack

- **Runtime**: Bun
- **API**: tRPC (type-safe)
- **Database**: PostgreSQL + Drizzle ORM
- **Analytics**: ClickHouse
- **Cache/Queue**: Redis
- **Search**: Meilisearch
- **Storage**: Cloudflare R2
- **Infrastructure**: Hetzner + Cloudflare

## Development Commands

```bash
# Development
bun run dev                 # Start all services
bun run health             # Check service health

# Database
bun run db:studio          # Drizzle Studio
bun run db:migrate         # Run migrations

# Infrastructure
bun run docker:up          # Start databases
bun run docker:logs        # View logs

# Quality
bun run test               # Run tests
bun run typecheck          # Type checking
bun run lint               # Linting
```

## Project Structure

```
gigz-v2/
├── apps/                  # Microservices
│   ├── gateway/          # API Gateway
│   ├── auth-api/         # Authentication
│   ├── core-api/         # Users, attendance, social
│   ├── concert-api/      # Concert data (ClickHouse)
│   ├── search-api/       # Search service
│   ├── scraper-worker/   # Concert scraping
│   └── notification-worker/ # Push notifications
├── packages/             # Shared packages
│   ├── db/              # Drizzle schema & client
│   ├── clickhouse/      # ClickHouse client
│   ├── redis/           # Redis utilities
│   ├── trpc/            # tRPC utilities
│   ├── types/           # Shared types
│   └── config/          # Configuration
└── tooling/             # Build tools
```

## Contributing

1. Read [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md)
2. Run `./setup-dev.sh`
3. Make changes
4. Run `bun run test && bun run typecheck && bun run lint`
5. Submit PR

## Status

- [x] API Gateway (GIG-119)
- [x] Redis Package (GIG-120)
- [ ] PostgreSQL Package (GIG-121)
- [ ] ClickHouse Package (GIG-122)
- [ ] Auth API (GIG-123)
- [ ] Core API (GIG-124)
- [ ] Concert API (GIG-125)
- [ ] Search API (GIG-126)

---

**Transform your concert memories. One show at a time.** 🎵