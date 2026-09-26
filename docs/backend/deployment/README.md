# NestJS Deployment & Production Engineering Standards

> **Domain**: Production Release Engineering, Containerization, Orchestration & Cloud Operations  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

Transitioning a NestJS application from local development to production demands rigorous release engineering. Production systems must be performant, resilient against crashes, observable under load, and capable of scaling horizontally across distributed infrastructure.

This guide details enterprise deployment standards for NestJS: compiled build artifacts, runtime process execution, containerization via multi-stage Docker builds, Kubernetes orchestration, health monitoring via Terminus, and automated cloud deployments via **Mau** (the official NestJS deployment platform on AWS).

```text
                             BUILD & RELEASE PIPELINE
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │          Build Compilation            │
                     │  • nest build / tsc (Pure ESM)        │
                     │  • Asset copying (.proto, static files│
                     │  • Output: dist/src/main.js           │
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │       Multi-Stage Docker Image        │
                     │  • Base: Node.js 24 Alpine + pnpm     │
                     │  • Builder: Compile TS & Prune DevDeps│
                     │  • Runner: Non-root 'node' + dumb-init│
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │     Container Registry & Ingress      │
                     │  (Amazon ECR / Docker Hub / GCR)      │
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │         Production Runtime            │
                     │  • Managed Cloud: Mau (AWS)           │
                     │  • Container Cluster: Kubernetes / ECS│
                     │  • Reverse Proxy: Nginx / AWS ALB     │
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │       Observability & Health          │
                     │  • Probes: /health/live, /health/ready│
                     │  • Terminus: DB, Redis, Memory, Disk  │
                     │  • APM: @nestjs/observe SDK Traces    │
                     └───────────────────────────────────────┘
```

---

## 1. Hosting Architecture Comparison

| Hosting Model | Platforms | Pros | Trade-offs |
| :--- | :--- | :--- | :--- |
| **Official Managed Cloud** | [Mau](https://mau.nestjs.com/) (AWS) | Single-command deployment (`nest deploy`), automated DB/broker provisioning, zero infra configuration, native AWS reliability. | Managed service cost; tied to AWS infrastructure. |
| **Container Orchestration** | Kubernetes (EKS, GKE, AKS), AWS ECS | Enterprise-grade autoscaling (HPA), zero-downtime rolling updates, declarative infrastructure (GitOps), fine-grained networking. | Operational complexity, requires dedicated DevOps/platform engineering. |
| **Serverless Containers** | AWS Fargate, Google Cloud Run | Pay-per-use, scale-to-zero, zero cluster maintenance, automatic TLS. | Cold start latencies, connection pool churn (requires RDS Proxy/PgBouncer). |
| **Self-Hosted Dedicated / VPS** | Hetzner, DigitalOcean, EC2 | Maximum hardware control, predictable low cost, customizable network kernel. | Manual backups, manual OS patching, manual load balancing and failover setup. |

---

## 2. Deployment Documentation Index

Explore the 4 comprehensive guides covering the complete production deployment lifecycle:

1. **[01 - Production Deployment Guide](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/deployment/01-deployment.md)**: Production compilation (`dist/`), `NODE_ENV=production` optimizations, process management, port binding, structured JSON logging, observability with `@nestjs/observe`, vertical vs. horizontal scaling, and **automated AWS deployment with Mau** (`nest deploy`).
2. **[02 - Enterprise Docker Packaging](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/deployment/02-docker.md)**: Production multi-stage Dockerfile for Node.js 24 LTS and pnpm monorepos, minimal image footprint, security hardening (dropping root privileges, `dumb-init` PID 1 signal forwarding), `.dockerignore`, and registry workflows.
3. **[03 - Scaling & Load Balancing](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/deployment/03-scaling-clustering.md)**: Horizontal pod autoscaling (HPA), reverse proxy configuration (Nginx, AWS ALB), HTTP/2, WebSocket connection upgrades, gRPC multiplexing, and stateless service design.
4. **[04 - Health Checks & Probes](file:///home/solo/JUNK/OFC/LK/araz/docs/backend/deployment/04-health-checks-terminus.md)**: Health monitoring with `@nestjs/terminus`, Kubernetes liveness and readiness probe design, database indicators (Drizzle/TypeORM), Redis indicators, memory threshold protection (`checkHeap`, `checkRSS`), and custom probes.

---

## 3. Production Deployment Checklist

- [ ] **Set `NODE_ENV=production`**: Ensure `NODE_ENV=production` is injected into the container/server environment to disable debugging overhead and enable framework optimizations.
- [ ] **Compile with Strict ESM**: Run `pnpm build` and verify that the emitted JavaScript bundle in `dist/` contains valid `.js` relative imports compatible with Node.js 24 `NodeNext`.
- [ ] **Configure Graceful Shutdown Hooks**: Call `app.enableShutdownHooks()` during bootstrap to handle `SIGTERM` and `SIGINT` signals, safely draining in-flight HTTP requests and closing database pools.
- [ ] **Run as Non-Root User**: In containerized environments, enforce `USER node` to prevent container breakout exploits.
- [ ] **Forward Process Signals (PID 1)**: Use an init system like `dumb-init` or `tini` as the container entrypoint so that Kubernetes `SIGTERM` signals reach Node.js.
- [ ] **Expose Health Probes**: Implement distinct `/health/liveness` and `/health/readiness` endpoints with `@nestjs/terminus` to prevent traffic from routing to unready pods.
- [ ] **Inject Secrets via Environment Variables**: Never hardcode credentials, database connection strings, or JWT signing keys in source code. Inject them securely via AWS Secrets Manager, HashiCorp Vault, or Kubernetes Secrets.
