# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Gigz V2
Transform Gigz from a manual logging tool into a living concert memory app.

Today, Gigz is a private journal where you type in every show by hand. It works, but it's work. V2 changes the equation:

Shows find you — stop typing, start confirming

History builds itself — backfill years of concerts without the grind

Share with people you know — not the internet, just your actual friends

Core Philosophy

Your journal is yours first. Social is a bonus, not the point. You're not performing for an audience or building a public concert-going persona. You're keeping a record of your live music life.

Friends only. No strangers, no followers, no algorithms. Mutual follow required — both people must opt in before they see each other's concerts. Inspired by Retro's approach: social features that strengthen real relationships instead of broadcasting to the void.

Concerts are naturally social. You went to that show with someone. You bumped into a friend in the crowd. The memory isn't just yours. V2 lets those shared moments live in the app.

Simple. You see your shows. You see your friends' shows. That's it.

## Overview

This epic covers all foundational technical work for Gigz v2 using a modern TypeScript-first stack with Bun, tRPC, Drizzle, and ClickHouse.

## Technical Stack

Runtime: Bun: Fast TypeScript runtime, native HTTP server
API Layer: tRPC: End-to-end type-safe APIs
App Database: PostgreSQL & Drizle: Users, attendance, social data
Concerts Database: ClickHouse: Column-oriented database for analytics
Cache/Queue: Redis w/ Bun Driver: Queuing, caching, rate limiting, pub/sub
Search: Meilisearch: Typo-tolerant search
File Storage: Cloudflare R2: Photo Storage
Hosting: Hetzner: Dedicated servers
DNS/CDN: Cloudflare: DDoS protection, DNS, CDN
Monorepo: Bun Workspaces: Native workspace support

## Architecture

┌─────────────────────────────────────────────────────────────────────────┐
│                           CLOUDFLARE                                     │
│              DNS │ DDoS Protection │ CDN │ R2 (Media)                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                         HETZNER INFRASTRUCTURE                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     API Gateway (Bun)                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│    ┌───────────┬───────────┬───────────┬───────────┬───────────┐       │
│    ▼           ▼           ▼           ▼           ▼           │       │
│ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐   │       │
│ │ Auth  │ │ Core  │ │Concert│ │Search │ │Scraper│ │Notif. │   │       │
│ │ API   │ │ API   │ │ API   │ │ API   │ │Worker │ │Worker │   │       │
│ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘   │       │
│     │         │         │         │         │         │         │       │
│     └────┬────┴────┬────┘         │         └────┬────┘         │       │
│          ▼         ▼              ▼              ▼               │       │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │       │
│   │PostgreSQL│ │ClickHouse│ │Meilisearch│ │  Redis   │           │       │
│   │ (Drizzle)│ │          │ │          │ │          │           │       │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘           │       │
└─────────────────────────────────────────────────────────────────────────┘

## Monorepo Structure (Bun Workspaces)

gigz-v2/
├── apps/
│   ├── gateway/              # API Gateway
│   ├── auth-api/             # Authentication service
│   ├── core-api/             # Users, Attendance, Social
│   ├── concert-api/          # Concert data (ClickHouse)
│   ├── search-api/           # Search service
│   ├── scraper-worker/       # Concert scraping
│   └── notification-worker/  # Push notifications
├── packages/
│   ├── db/                   # Drizzle schema & client
│   ├── clickhouse/           # ClickHouse schema & client
│   ├── redis/                # Redis client & queue utils
│   ├── trpc/                 # Shared tRPC utilities
│   ├── types/                # Shared TypeScript types
│   ├── config/               # Shared configuration
│   ├── logger/               # Pino logging
│   └── utils/                # Common utilities
├── tooling/
│   ├── typescript-config/    # Shared tsconfig
│   └── eslint-config/        # Shared ESLint rules
├── docker/
├── package.json
└── bun.lockb

## Development Commands

### Local Development Setup

Start all required services (PostgreSQL, ClickHouse, Redis, Meilisearch):
```bash
docker-compose up -d
```

### Workspace Commands

Start all services in development mode:
```bash
bun run dev
```

Start individual services:
```bash
bun run dev:gateway     # API Gateway
bun run dev:auth        # Authentication API
bun run dev:core        # Core API (Users, Attendance, Social)
bun run dev:concert     # Concert API (ClickHouse)
bun run dev:search      # Search API (Meilisearch)
bun run dev:scraper     # Scraper Worker
bun run dev:notifications # Notification Worker
```

### Build and Quality Commands

Build all workspace packages:
```bash
bun run build
```

Run tests across all packages:
```bash
bun run test
```

Run linting across all packages:
```bash
bun run lint
```

Run type checking across all packages:
```bash
bun run typecheck
```

### Database Commands

Generate Drizzle migrations:
```bash
bun run db:generate
```

Run migrations:
```bash
bun run db:migrate
```

Push schema changes (development):
```bash
bun run db:push
```

Open Drizzle Studio:
```bash
bun run db:studio
```

### Cleanup

Remove all node_modules:
```bash
bun run clean
```

## Architecture Notes

### Service Communication
- All services communicate through the API Gateway using tRPC
- Inter-service communication uses type-safe tRPC procedures
- Shared types are defined in `packages/types`
- Database schemas are centralized in `packages/db` and `packages/clickhouse`

### Data Flow
- User/social data flows through Core API → PostgreSQL (via Drizzle)
- Concert analytics flow through Concert API → ClickHouse
- Search indexing flows through Search API → Meilisearch
- Background tasks use Redis queuing via Worker services

### Shared Packages
- `packages/db`: PostgreSQL schema, migrations, and Drizzle client
- `packages/clickhouse`: ClickHouse schema and client
- `packages/trpc`: Shared tRPC router definitions and utilities
- `packages/redis`: Redis client and queue management utilities
- `packages/types`: Shared TypeScript type definitions
- `packages/config`: Environment configuration and validation
- `packages/logger`: Structured logging with Pino
- `packages/utils`: Common utility functions

### Development Workflow
- Use Bun workspaces for package management
- TypeScript configuration is shared via `@gigz/typescript-config`
- ESLint configuration is shared via `@gigz/eslint-config`
- Always run `bun run typecheck` and `bun run lint` before committing
- Use Linear MCP to read and follow instrucitons on work. Update Linear issues when working. For this proejct our issues are under GIG.