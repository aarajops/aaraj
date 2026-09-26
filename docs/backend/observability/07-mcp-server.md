# 07 - Model Context Protocol (MCP) Server

> **Source Reference**: [NestJS Official Documentation - MCP Server](https://docs.nestjs.com/observability/mcp-server)

NestJS Observe provides an integrated [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server. This allows AI coding assistants and autonomous agents (such as Antigravity, Claude Code, Cursor, and Copilot) to directly inspect telemetry, diagnose production defects, query trace waterfalls, and verify incident fixes without manual copy-pasting of dashboard data.

The MCP endpoint communicates over **Streamable HTTP** at:
```http
POST https://<api-host>/mcp
```
The endpoint is completely stateless and requires no persistent socket maintenance or OAuth handshake.

---

## 1. Authentication & Personal MCP Tokens

Personal MCP tokens are generated via the Observe dashboard under **Settings → MCP Tokens**:

1. Click **Create Token** and specify a description (e.g. `cursor-agent-local` or `antigravity-ci`).
2. The generated token secret (`omcp_...`) is displayed **only once**. Save it immediately to your local secrets manager or `.env` file (`OBSERVE_MCP_TOKEN`).
3. **Security Scope**: Tokens execute with the exact project and team permissions of the user who created them. If your user account can view an application or error, the agent can query it over MCP.

---

## 2. Connecting Coding Agents

### Claude Code CLI

```bash
claude mcp add observe --transport http https://<api-host>/mcp --header "Authorization: Bearer <token>"
```

### Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`)

Cursor expands environment variables automatically:

```json
{
  "mcpServers": {
    "observe": {
      "url": "https://<api-host>/mcp",
      "headers": {
        "Authorization": "Bearer ${env:OBSERVE_MCP_TOKEN}"
      }
    }
  }
}
```

### VS Code Copilot (`.vscode/mcp.json`)

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "observe-token",
      "description": "NestJS Observe Personal MCP Token",
      "password": true
    }
  ],
  "servers": {
    "observe": {
      "type": "http",
      "url": "https://<api-host>/mcp",
      "headers": {
        "Authorization": "Bearer ${input:observe-token}"
      }
    }
  }
}
```

### Direct Programmatic Client (TypeScript SDK)

```typescript
// scripts/connect-observe-mcp.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'araz-diagnostic-agent', version: '1.0.0' });

await client.connect(
  new StreamableHTTPClientTransport(new URL('https://<api-host>/mcp'), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${process.env.OBSERVE_MCP_TOKEN}`,
      },
    },
  }),
);

const { tools } = await client.listTools();
console.log(`Connected to NestJS Observe. Available tools: ${tools.length}`);
```

### Connectivity Verification (`curl`)

```bash
curl -s https://<api-host>/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## 3. Autonomous AI Incident Investigation Workflow

When an agent is asked to triage a production regression, it executes a deterministic diagnostic path:

```text
1. [find_regressions] ────────▶ Identifies the deploy commit that increased latency
         │
         ▼
2. [get_operation_details] ───▶ Fetches p95 latency and recent failing trace IDs
         │
         ▼
3. [get_trace] ───────────────▶ Resolves trace ID to inspect full waterfall and throwing span
         │
         ▼
4. [get_trace_logs] ──────────▶ Pulls exact chronological application log output
         │
         ▼
5. [Code Edit & Test] ────────▶ Agent applies code fix and runs test suite
         │
         ▼
6. [resolve_issue] ───────────▶ Triggers automated verification against baseline
```

---

## 4. MCP Tools Directory

### Diagnostic Read-Only Tools

| Tool Name | Parameters | What It Answers |
| :--- | :--- | :--- |
| `list_projects` | None | Lists all projects the user belongs to with team IDs. |
| `get_project` | `projectId` | Returns project details, access roles, and subscription state. |
| `search` | `projectId`, `query` | Full-text search across alert rules, SLOs, issues, and services. |
| `find_regressions` | `projectId`, `timeInterval?` | Compares latency and error rate before vs. after releases. |
| `list_slow_operations` | `projectId`, `timeInterval?` | Returns slowest HTTP routes ranked by p95 latency. |
| `get_operation_details` | `projectId`, `operationId` | Route latency summary, error counts, and recent trace IDs. |
| `get_trace` | `projectId`, `traceId` | Complete span waterfall across distributed services. |
| `get_trace_logs` | `projectId`, `traceId` | Chronologically ordered log lines emitted during the trace. |
| `list_error_groups` | `projectId`, `timeInterval?` | Fingerprinted defects ranked by occurrence frequency. |
| `get_error_details` | `projectId`, `groupId` | Stack traces, sample messages, and impacted users for an error. |
| `get_error_trend` | `projectId`, `groupId` | Whether an error is growing, stabilizing, or decaying. |
| `get_affected_users` | `projectId`, `groupId` | Blast radius: distinct user IDs affected by an error defect. |
| `list_jobs` | `projectId`, `timeInterval?` | Background queue performance by queue name and job name. |
| `get_job_details` | `projectId`, `jobName`, `queue` | Queue wait durations and execution history for a job. |
| `list_slos` | `projectId` | Returns SLO compliance status and current error budget burn. |
| `list_alert_rules` | `projectId` | Configured alert thresholds, anomaly detectors, and silence rules. |

### Service Administration & Automation Tools

| Tool Name | Parameters | Purpose |
| :--- | :--- | :--- |
| `list_applications` | `projectId` | Lists registered applications within a project. |
| `create_project` | `name`, `teamId` | Creates a new telemetry project. |
| `create_application` | `projectId`, `name` | Registers a new service matching SDK `serviceId`. |
| `create_api_key` | `projectId`, `name` | Generates a new API key pair (`appKey`, `appSecret`). |
| `resolve_issue` | `projectId`, `issueId` | Marks an issue resolved, initiating baseline verification. |
