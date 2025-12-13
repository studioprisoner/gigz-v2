# Gigz V2 Docker Setup

All Gigz V2 services are now fully containerized using Docker and Docker Compose. This provides consistent development environments, easier deployment, and better isolation between services.

## Quick Start

### Development Environment

```bash
# Start all development services
bun run dev

# View logs from all services
bun run dev:logs

# Stop all services
bun run dev:stop
```

### Production Environment

```bash
# Build and start production services
bun run prod

# View production logs
bun run prod:logs

# Stop production services
bun run prod:stop
```

## Architecture Overview

### Services

| Service | Port | Description |
|---------|------|-------------|
| **gateway** | 3001 | API Gateway - routes requests to appropriate services |
| **auth-api** | 3002 | Authentication service (login, tokens, admin auth) |
| **core-api** | 3003 | Core functionality (users, social features) |
| **concert-api** | 3004 | Concert data and analytics (ClickHouse) |
| **search-api** | 3005 | Search functionality (Meilisearch) |
| **scraper-worker** | - | Background job processor for concert scraping |
| **notification-worker** | - | Push notification processing |
| **admin** | 5173 (dev) / 80 (prod) | React admin dashboard |

### Databases

| Service | Port | Purpose |
|---------|------|---------|
| **postgres** | 5432 | Main application database |
| **clickhouse** | 8123/9000 | Analytics and concert data |
| **redis** | 6379 | Caching, queuing, pub/sub |
| **meilisearch** | 7700 | Search indexing |

### Development Tools (Optional)

| Tool | Port | Purpose |
|------|------|---------|
| **pgadmin** | 8080 | PostgreSQL database admin |
| **redis-commander** | 8081 | Redis database admin |

## Docker Configurations

### Development (docker-compose.dev.yml)

- **Hot reloading**: Source code mounted as volumes for instant changes
- **Development builds**: Uses `development` target with `bun run dev`
- **Debugging friendly**: All ports exposed, verbose logging
- **Tool access**: Includes pgAdmin and Redis Commander
- **Environment**: Uses hardcoded development credentials

### Production (docker-compose.prod.yml)

- **Optimized builds**: Multi-stage builds with production targets
- **Security**: Environment variables from `.env.prod` file
- **Scaling**: Configured with resource limits and replicas
- **Health checks**: Comprehensive health monitoring
- **Performance**: Nginx for static file serving, optimized settings

## Development Workflow

### Starting Development

```bash
# First time setup
bun run setup  # Starts DBs, runs migrations, seeds data

# Start all services
bun run dev

# Start with rebuild (after dependency changes)
bun run dev:build
```

### Viewing Logs

```bash
# All services
bun run dev:logs

# Specific service
bun run dev:logs:gateway
bun run dev:logs:auth
bun run dev:logs:admin

# Follow logs for specific service
docker-compose -f docker-compose.dev.yml logs -f gateway
```

### Running Commands

```bash
# Database operations
bun run db:migrate
bun run db:seed
bun run db:studio

# Testing
bun run test
bun run test:watch
bun run lint

# Shell access
bun run shell:gateway
bun run shell:auth
bun run shell:admin
```

### Service Management

```bash
# Restart specific service
bun run dev:restart:gateway
bun run dev:restart:auth

# View service status
bun run status

# Check health
bun run health
```

### Development Tools

```bash
# Start with admin tools
bun run dev:tools

# Access tools:
# - pgAdmin: http://localhost:8080 (admin@gigz.dev / password)
# - Redis Commander: http://localhost:8081 (admin / password)
```

## Production Deployment

### Environment Setup

1. **Copy environment template**:
   ```bash
   cp .env.prod.example .env.prod
   ```

2. **Configure production variables**:
   ```bash
   # Edit .env.prod with secure values
   vim .env.prod
   ```

3. **Build and deploy**:
   ```bash
   bun run prod:build
   ```

### Environment Variables

Required production environment variables:

- `POSTGRES_USER` / `POSTGRES_PASSWORD`
- `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD`
- `REDIS_PASSWORD`
- `MEILISEARCH_KEY`
- `JWT_SECRET` (minimum 32 characters)
- `APPLE_CLIENT_ID` / `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY`
- `GOOGLE_CLIENT_ID`

### Production Features

- **Auto-scaling**: Services configured with replicas
- **Resource limits**: CPU/memory constraints
- **Health monitoring**: Automatic restart on failure
- **Security**: Secure defaults, no exposed credentials
- **Performance**: Optimized builds, efficient resource usage

## File Structure

```
gigz-v2/
├── docker/
│   ├── Dockerfile.base          # Base Dockerfile for Bun services
│   ├── Dockerfile.admin         # React admin dashboard
│   └── nginx/
│       └── admin.conf           # Nginx config for admin
├── docker-compose.dev.yml       # Development environment
├── docker-compose.prod.yml      # Production environment
├── .env.prod.example           # Production env template
└── DOCKER.md                   # This documentation
```

## Troubleshooting

### Common Issues

1. **Port conflicts**: Check if ports 3001-3005, 5173, 5432, 6379, 7700, 8123 are available
2. **Build failures**: Run `bun run clean` then `bun run dev:build`
3. **Database connection issues**: Ensure PostgreSQL is healthy: `docker-compose -f docker-compose.dev.yml ps`
4. **Volume permissions**: On Linux, may need to adjust file permissions

### Debugging Commands

```bash
# View service status
bun run status

# Check service health
docker-compose -f docker-compose.dev.yml ps

# View specific service logs
bun run dev:logs:gateway

# Get shell access
bun run shell:gateway

# Restart problematic service
docker-compose -f docker-compose.dev.yml restart gateway

# Complete reset
bun run clean
bun run dev:build
```

### Performance Optimization

1. **Development**: Use `bun run dev` for fastest startup
2. **Testing**: Use `bun run dev:build` after dependency changes
3. **Database**: Keep pgAdmin/Redis Commander stopped when not needed
4. **Resources**: Monitor Docker Desktop resource usage

## Networking

All services communicate through the `gigz-network` Docker network:

- **Service discovery**: Services can reach each other by container name
- **Database URLs**: Use container names (e.g., `postgres:5432`, `redis:6379`)
- **API communication**: Services communicate internally, only gateway exposed externally
- **Security**: Isolated network prevents external access to internal services

## Next Steps

1. **Monitoring**: Add Prometheus/Grafana for production monitoring
2. **CI/CD**: Integrate with GitHub Actions for automated deployment
3. **Secrets**: Use Docker secrets or external secret management
4. **Load Balancing**: Add nginx/traefik for production load balancing
5. **Logging**: Centralized logging with ELK stack or similar

## Admin Access

The admin dashboard is available at:
- **Development**: http://localhost:5173
- **Production**: http://localhost (port 80)

**Admin credentials**: support@gig.app / GigzAdmin2024!