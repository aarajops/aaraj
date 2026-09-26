# Production Dockerization & Multi-Stage Builds

> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Alpine Linux / pnpm Monorepo  
> **Architecture Target**: Linux x86_64 & arm64 (Multi-Arch)

Containerizing a NestJS application using Docker ensures consistent behavior across development, staging, and production environments. For enterprise monorepos, using **multi-stage Docker builds** is critical to:
1. Strip build tools, TypeScript compilers, test runners, and devDependencies from the final runtime image.
2. Minimize image size (reducing transfer times and cold start duration).
3. Enforce security hardening by dropping root privileges and running as a dedicated non-root user.
4. Solve the Node.js PID 1 zombie process problem using a lightweight init system (`dumb-init`).

---

## 1. Enterprise Multi-Stage `Dockerfile`

The following production `Dockerfile` is optimized for Node.js 24 LTS, pnpm workspaces, and NestJS:

```dockerfile
# ==============================================================================
# STAGE 1: Base Image (Node.js 24 Alpine with pnpm & dumb-init)
# ==============================================================================
FROM node:24-alpine AS base

# Install dumb-init for proper PID 1 signal forwarding (SIGTERM / SIGINT)
RUN apk add --no-cache dumb-init

# Enable Corepack and prepare pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate

WORKDIR /app

# ==============================================================================
# STAGE 2: Dependencies Installation
# ==============================================================================
FROM base AS dependencies

# Copy package manifests across workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/

# Install all dependencies (including devDependencies required for compilation)
RUN pnpm install --frozen-lockfile

# ==============================================================================
# STAGE 3: Build Compilation
# ==============================================================================
FROM dependencies AS builder

# Copy source files across the monorepo
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Build shared contracts package first
RUN pnpm --filter @araz/contracts build

# Build NestJS production application bundle
RUN pnpm --filter @araz/api build

# Prune devDependencies to keep only production packages for runtime
RUN pnpm prune --prod

# ==============================================================================
# STAGE 4: Production Runner
# ==============================================================================
FROM node:24-alpine AS runner

# Install dumb-init in final runner stage
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Run as unprivileged 'node' user provided by official Alpine image
USER node

# Copy production node_modules from builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --chown=node:node --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --chown=node:node --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=builder /app/apps/api/package.json ./apps/api/package.json

EXPOSE 3000

# Use dumb-init as PID 1 to ensure graceful shutdown on SIGTERM
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Execute compiled NestJS application entry point
CMD ["node", "apps/api/dist/src/main.js"]
```

---

## 2. Production `.dockerignore`

To prevent unnecessary files from bloating the build context:

```text
# Local dependencies
node_modules/
.pnpm-store/

# Compiled outputs
dist/
build/
.next/

# Environment files and credentials
.env
.env.*
!.env.example
*.pem
*.key

# Git and IDE files
.git/
.gitignore
.vscode/
.idea/

# Testing and Coverage
coverage/
*.spec.ts
*.test.ts

# Documentation and logs
docs/
*.log
.DS_Store
```

---

## 3. Building, Running & Tagging Containers

### 3.1 Building the Container Image

```bash
docker build -t araz-api:latest -f Dockerfile .
```

### 3.2 Running Locally with Environment Variables

```bash
docker run -d \
  --name araz-api \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/araz" \
  araz-api:latest
```

---

## 4. Publishing to Container Registries

### 4.1 Amazon Elastic Container Registry (ECR)

```bash
# 1. Authenticate Docker with AWS ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# 2. Tag image with ECR repository URI
docker tag araz-api:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/araz-api:v1.0.0

# 3. Push container image
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/araz-api:v1.0.0
```

### 4.2 Google Artifact Registry (GAR)

```bash
# 1. Authenticate with Google Cloud
gcloud auth configure-docker us-central1-docker.pkg.dev

# 2. Tag and push
docker tag araz-api:latest us-central1-docker.pkg.dev/my-project/araz-repo/araz-api:v1.0.0
docker push us-central1-docker.pkg.dev/my-project/araz-repo/araz-api:v1.0.0
```
