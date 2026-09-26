# CI/CD Integration & Architectural Drift Governance

> **Domain**: Continuous Integration, Automated Graph Publishing & Pull Request Diffs  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

While local Devtools provides real-time architectural exploration, integrating Devtools into your CI/CD delivery pipeline transforms it into an **architectural governance system**.

Every build publishes a snapshot of your application's dependency graph. Pull requests targeting protected branches (`main`, `master`, `production`) automatically receive an **Architectural Difference Report** highlighting added, modified, or removed modules, providers, guards, and route handlers.

---

## 1. Application Bootstrap Configuration (`main.ts`)

Configure `src/main.ts` to support conditional graph publishing using `GraphPublisher`:

```typescript
import { NestFactory } from '@nestjs/core';
import { GraphPublisher } from '@nestjs/devtools-integration';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const shouldPublishGraph = process.env.PUBLISH_GRAPH === 'true';

  const app = await NestFactory.create(AppModule, {
    snapshot: true,
    preview: shouldPublishGraph, // Preview mode prevents constructors & lifecycle hooks from running
  });

  if (shouldPublishGraph) {
    await app.init();

    const publishOptions = {
      apiKey: process.env.DEVTOOLS_API_KEY!,
      repository: process.env.REPOSITORY_NAME!,
      owner: process.env.REPOSITORY_OWNER!,
      sha: process.env.COMMIT_SHA!,
      target: process.env.TARGET_SHA,
      trigger: (process.env.IS_PULL_REQUEST === 'true' ? 'pull' : 'push') as 'pull' | 'push',
      branch: process.env.BRANCH_NAME!,
    };

    const graphPublisher = new GraphPublisher(app);
    await graphPublisher.publish(publishOptions);

    await app.close();
  } else {
    await app.listen(process.env.PORT ?? 3000);
  }
}
await bootstrap();
```

> **Why `preview: true`?**: Bootstrapping in preview mode constructs the dependency graph metadata without instantiating database pools, connecting to message brokers, or executing `onModuleInit` lifecycle hooks. This ensures CI pipelines run instantaneously without external service dependencies.

---

## 2. GitHub Actions Integration

Create `.github/workflows/publish-graph.yml` in your repository:

```yaml
name: Devtools Architectural Snapshot

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

jobs:
  publish:
    if: github.actor != 'dependabot[bot]'
    name: Publish Dependency Graph
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'

      - name: Install pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 12.5.1

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Configure PR Metadata
        if: github.event_name == 'pull_request'
        shell: bash
        run: |
          echo "COMMIT_SHA=${{ github.event.pull_request.head.sha }}" >> $GITHUB_ENV
          echo "IS_PULL_REQUEST=true" >> $GITHUB_ENV
          echo "BRANCH_NAME=${{ github.head_ref }}" >> $GITHUB_ENV
          echo "TARGET_SHA=${{ github.event.pull_request.base.sha }}" >> $GITHUB_ENV

      - name: Configure Push Metadata
        if: github.event_name == 'push'
        shell: bash
        run: |
          echo "COMMIT_SHA=${{ github.sha }}" >> $GITHUB_ENV
          echo "IS_PULL_REQUEST=false" >> $GITHUB_ENV
          echo "BRANCH_NAME=${{ github.ref_name }}" >> $GITHUB_ENV

      - name: Publish Graph Snapshot
        run: pnpm --filter @araz/api run start
        env:
          PUBLISH_GRAPH: 'true'
          DEVTOOLS_API_KEY: ${{ secrets.DEVTOOLS_API_KEY }}
          REPOSITORY_NAME: ${{ github.event.repository.name }}
          REPOSITORY_OWNER: ${{ github.repository_owner }}
```

---

## 3. GitLab CI/CD Pipeline

Add the publishing stage to `.gitlab-ci.yml`:

```yaml
image: node:24

stages:
  - build
  - governance

publish_devtools_graph:
  stage: governance
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "main"
  script:
    - npm install -g pnpm@12.5.1
    - pnpm install --frozen-lockfile
    - PUBLISH_GRAPH=true pnpm --filter @araz/api run start
  variables:
    DEVTOOLS_API_KEY: $DEVTOOLS_API_KEY
    REPOSITORY_NAME: $CI_PROJECT_NAME
    REPOSITORY_OWNER: $CI_PROJECT_ROOT_NAMESPACE
    COMMIT_SHA: $CI_COMMIT_SHA
    TARGET_SHA: $CI_MERGE_REQUEST_DIFF_BASE_SHA
    BRANCH_NAME: $CI_COMMIT_REF_NAME
    IS_PULL_REQUEST: $CI_MERGE_REQUEST_IID ? "true" : "false"
```

---

## 4. Pull Request Architectural Diffing & Drift Reports

Once integrated with GitHub or GitLab, Devtools automatically analyzes the structural difference between the feature branch and the target branch:

```text
                               PULL REQUEST ARCHITECTURAL DIFF
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              ▼                               ▼                               ▼
       [Green Nodes]                    [White Nodes]                    [Red Nodes]
        Added Nodes                    Modified Nodes                   Deleted Nodes
     • New AuthInterceptor            • UserModule (Scope Changed)     • LegacyBillingGuard
```

### Critical Architectural Catastrophes Caught in PRs

1. **Accidental Guard Removal**: If an engineer inadvertently deletes `@UseGuards(JwtAuthGuard)` from an endpoint, the report highlights the missing enhancer immediately.
2. **Provider Scope Inflation**: Changing a service from default `DEFAULT` (singleton) to `REQUEST` scope degrades throughput. Devtools flags this change directly on the review page.
3. **Module Over-Coupling**: Making a module global (`@Global()`) introduces dozens of new edges across the entire dependency graph, making the architectural impact visible before merge.
