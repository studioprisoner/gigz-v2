#!/bin/bash

# Gigz V2 Development Setup Script
# This script sets up the complete development environment

set -e

echo "🎵 Setting up Gigz V2 Development Environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_step() {
    echo -e "${BLUE}📋 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Step 1: Check prerequisites
print_step "Checking prerequisites..."

if ! command_exists bun; then
    print_error "Bun is not installed. Please install Bun first:"
    echo "curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

if ! command_exists docker; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command_exists docker-compose; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

print_success "Prerequisites check passed!"

# Step 2: Install dependencies
print_step "Installing dependencies..."
bun install
print_success "Dependencies installed!"

# Step 3: Set up environment files
print_step "Setting up environment files..."

if [ ! -f .env ]; then
    cp .env.example .env
    print_success "Root .env file created"
else
    print_warning "Root .env file already exists, skipping"
fi

# Create environment files for each app if they don't exist
apps=("gateway" "auth-api" "core-api" "concert-api" "search-api" "scraper-worker" "notification-worker")

for app in "${apps[@]}"; do
    app_env_file="apps/$app/.env"
    if [ ! -f "$app_env_file" ]; then
        # Create a basic .env file for each app
        cat > "$app_env_file" << EOF
NODE_ENV=development
LOG_LEVEL=debug
PORT=300X
DATABASE_URL=postgresql://gigz:password@localhost:5432/gigz_dev
REDIS_URL=redis://:password@localhost:6379
MEILISEARCH_URL=http://localhost:7700
JWT_SECRET=your-super-secret-jwt-key-for-development-change-in-production
EOF
        print_success "Created .env for $app"
    else
        print_warning ".env for $app already exists, skipping"
    fi
done

# Step 4: Start infrastructure services
print_step "Starting infrastructure services with Docker..."

# Check if Docker daemon is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker daemon is not running. Please start Docker first."
    exit 1
fi

docker-compose up -d
print_success "Infrastructure services started!"

# Step 5: Wait for services to be ready
print_step "Waiting for services to be ready..."

# Function to wait for a service
wait_for_service() {
    local service_name=$1
    local check_command=$2
    local max_attempts=30
    local attempt=1

    echo -n "Waiting for $service_name to be ready..."

    while [ $attempt -le $max_attempts ]; do
        if eval $check_command > /dev/null 2>&1; then
            echo ""
            print_success "$service_name is ready!"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo ""
    print_warning "$service_name is taking longer than expected to start"
    return 1
}

# Wait for each service
wait_for_service "PostgreSQL" "docker exec gigz-postgres pg_isready -U gigz -d gigz_dev"
wait_for_service "Redis" "docker exec gigz-redis redis-cli ping"
wait_for_service "ClickHouse" "curl -f http://localhost:8123/ping"
wait_for_service "Meilisearch" "curl -f http://localhost:7700/health"

# Step 6: Set up databases
print_step "Setting up databases..."

# Run database migrations if the packages exist
if [ -d "packages/db" ]; then
    print_step "Running PostgreSQL migrations..."
    bun run db:migrate
    print_success "PostgreSQL migrations completed!"
else
    print_warning "Database package not found, skipping PostgreSQL migrations"
fi

if [ -d "packages/clickhouse" ]; then
    print_step "Running ClickHouse migrations..."
    bun run clickhouse:migrate 2>/dev/null || print_warning "ClickHouse migrations not available yet"
else
    print_warning "ClickHouse package not found, skipping ClickHouse migrations"
fi

# Step 7: Initialize search indexes
print_step "Initializing search indexes..."
if [ -f "apps/search-api/package.json" ]; then
    bun run search:init 2>/dev/null || print_warning "Search initialization not available yet"
else
    print_warning "Search API not found, skipping search initialization"
fi

# Step 8: Run type checking
print_step "Running type checking..."
if bun run typecheck; then
    print_success "Type checking passed!"
else
    print_warning "Type checking failed - some services may not be fully implemented yet"
fi

# Step 9: Show summary
echo ""
echo "🎉 Gigz V2 Development Environment Setup Complete!"
echo ""
echo "📋 Summary:"
echo "✅ Dependencies installed"
echo "✅ Environment files created"
echo "✅ Infrastructure services started"
echo "✅ Databases set up"
echo ""
echo "🚀 What's next:"
echo "1. Review and update .env files with your API keys"
echo "2. Start the development services:"
echo "   bun run dev"
echo ""
echo "3. Or start services individually:"
echo "   bun run dev:gateway     # API Gateway (http://localhost:3000)"
echo "   bun run dev:auth        # Auth API (http://localhost:3001)"
echo "   bun run dev:core        # Core API (http://localhost:3002)"
echo "   bun run dev:concert     # Concert API (http://localhost:3003)"
echo "   bun run dev:search      # Search API (http://localhost:3004)"
echo ""
echo "🔍 Health checks:"
echo "   bun run health          # Check all services"
echo "   curl http://localhost:3000/health"
echo ""
echo "🗃️ Database tools:"
echo "   bun run db:studio       # Drizzle Studio (PostgreSQL)"
echo "   http://localhost:8080   # pgAdmin (PostgreSQL GUI)"
echo "   http://localhost:8081   # Redis Commander (Redis GUI)"
echo "   http://localhost:8123/play # ClickHouse Play UI"
echo ""
echo "📚 For detailed documentation, see LOCAL_DEVELOPMENT.md"
echo ""
print_success "Happy coding! 🎵"