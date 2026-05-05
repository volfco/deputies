# Architecture

## Summary

The system is a portable background-agent control plane with Flue as the execution harness. It starts as a single Node service containing HTTP API routes, worker loops, integration handlers, event streaming, persistence, and runner adapters.

The system should be deployable to:

- Railway: one service plus Postgres, with optional object storage and Redis later.
- ECS Fargate + RDS: one task/service plus RDS, optionally split into API and worker services.
- Kubernetes: one Deployment plus Postgres and object storage, optionally split into multiple Deployments.

Cloud-specific primitives such as Durable Objects, D1, KV, or provider-native queues must not be required for correctness.

## Initial Deployment Shape

```txt
background-agent service
  HTTP API
  worker loop
  event streaming
  integration routes
  Flue runner adapter
  sandbox lifecycle manager
  Postgres store

Postgres
  sessions
  messages
  events
  runs
  sandboxes
  flue_sessions
  artifacts
  external thread mappings

Object storage, optional at first
  logs
  screenshots
  large artifacts
```

Run modes:

```txt
RUN_MODE=all       # API + worker in one process, default MVP
RUN_MODE=api       # API only, future split
RUN_MODE=worker    # Worker only, future split
```

The code must behave correctly with multiple replicas even when deployed in `RUN_MODE=all`. Postgres leases and locks are required from the beginning.

## Module Layout

```txt
src/
  api/
  app/
  sessions/
  messages/
  runs/
  worker/
  runner-flue/
  sandbox/
  integrations/
    common/
    generic-webhook/
    github/
    slack/
    linear/
  events/
  artifacts/
  store/
  config/
  auth/
  prompts/

docs/
  background-agents/
  architecture/
  decisions/
  deployment/

agent-constraints/
  planning.md
  adversarial-review.md
  implementation.md
  testing.md
  security.md
```

## Responsibility Split

| Module | Owns | Does Not Own |
|---|---|---|
| `api` | HTTP routes, request validation, auth boundaries, response formatting | Agent execution, sandbox lifecycle decisions |
| `app` | Process bootstrap, run mode, graceful shutdown | Business logic |
| `sessions` | Durable task workspace lifecycle and status | SQL details, Flue calls |
| `messages` | Prompt/follow-up queue semantics | Running prompts |
| `runs` | Active execution leases, retry state, run status | Integration-specific behavior |
| `worker` | Claiming runnable work and coordinating execution | HTTP concerns |
| `runner-flue` | Flue initialization and event normalization | Session persistence policy |
| `sandbox` | Provider interface, lifecycle, health, cleanup | Prompt construction |
| `integrations` | External webhook/auth normalization and callbacks | Direct agent execution |
| `events` | Append-only event log, replay, subscriber fanout | Business decisions |
| `artifacts` | PRs, branches, screenshots, object links, reports | Raw runner protocol |
| `store` | Postgres queries, migrations, transactions | Domain decisions |
| `config` | Env parsing, validation, feature flags | Business logic |
| `auth` | App/user/service auth helpers | Route-specific request handling |
| `prompts` | Prompt templates and source-specific context rendering | External API calls |

## Dependency Rules

Allowed dependency direction:

```txt
api -> sessions/messages/events/auth
worker -> messages/sessions/runs/sandbox/runner-flue/events/artifacts
integrations -> sessions/messages/events/prompts/auth
runner-flue -> events/sandbox/prompts
sandbox -> store/config
sessions/messages/runs/events/artifacts -> store
store -> postgres driver only
```

Forbidden dependencies:

```txt
api -> runner-flue
integrations -> runner-flue
runner-flue -> api
store -> domain modules
sessions/messages -> integration-specific modules
```

Only `runner-flue` should import `@flue/sdk`. This keeps Flue replaceable and makes tests easier.

`runner-flue` must also provide or configure a Postgres-backed Flue session store. Flue's Node default is in-memory and is not acceptable for production, CI, UAT, or multi-replica deployments. Product state and Flue runtime state are separate but both must be durable.

## Request Flow

When a user or integration sends a prompt:

```txt
POST /sessions/:id/messages or integration webhook
  -> validate request
  -> find or create session
  -> append pending message
  -> append message_created event
  -> return 202 Accepted
```

No model call happens in the request path.

Worker execution:

```txt
worker loop
  -> claim pending message using Postgres transaction
  -> acquire session run lease
  -> ensure sandbox exists and is healthy
  -> start Flue runner
  -> normalize Flue/sandbox events into event log
  -> record artifacts
  -> mark message completed or failed
  -> release lease
```

## Concurrency Model

Correctness must not depend on a single process.

Rules:

- Multiple API replicas may receive messages for the same session.
- Multiple worker replicas may poll concurrently.
- Only one active run may process a session at a time.
- Follow-up messages must queue behind the active run or be injected at safe turn boundaries.
- Worker crashes must not permanently strand messages in `processing`.

Implementation mechanisms:

- `SELECT ... FOR UPDATE SKIP LOCKED` for message claiming.
- Session-level run lease rows or Postgres advisory locks.
- Lease expiry and heartbeat timestamps.
- Idempotent event writes where possible.
- Dedupe keys for external webhooks.

## Runner Interface

The worker should call a generic runner interface, not Flue directly.

```ts
interface Runner {
  run(input: RunnerInput): Promise<RunnerResult>;
}

type RunnerInput = {
  sessionId: string;
  messageId: string;
  prompt: string;
  context: PromptContext;
  sandbox: SandboxHandle;
  emit: (event: NormalizedEvent) => Promise<void>;
};
```

Implementations:

- `FakeRunner` for deterministic unit/e2e tests.
- `FlueRunner` for production.
- Future runners if needed.

`FlueRunner` responsibilities include:

- configure Flue with the Postgres-backed Flue session store;
- use stable Flue agent/session IDs derived from product session IDs;
- treat Flue session data as runner-owned state;
- persist normalized product events separately through the `events` module.

## Sandbox Interface

```ts
interface SandboxProvider {
  create(input: CreateSandboxInput): Promise<SandboxHandle>;
  connect(id: string): Promise<SandboxHandle>;
  destroy(id: string): Promise<void>;
  snapshot?(id: string): Promise<SandboxSnapshot>;
  restore?(snapshotId: string): Promise<SandboxHandle>;
}
```

Provider choices should be config-driven:

```txt
SANDBOX_PROVIDER=fake|local-docker|daytona|kubernetes|ecs
```

MVP should include `fake` for tests and one real provider.

## Streaming Model

The event log is the source of truth.

Streaming endpoints should support replay:

```txt
GET /sessions/:id/events?after=<cursor>
GET /sessions/:id/events/stream?after=<cursor>
```

SSE is sufficient for MVP. WebSockets can be added later if bidirectional session control requires it.

## Trust Model

Trust boundaries are layered:

- Inbound requests are authenticated and deduped.
- External content is marked as untrusted in prompts.
- Integrations cannot run agents directly.
- Runner publishes events but cannot mutate session state except through worker-owned APIs.
- Publication actions such as PR creation should be explicit artifacts with verification.
- Destructive sandbox/provider operations require narrow interfaces.

The service is initially designed for trusted single-tenant organization deployments. Multi-tenant support requires explicit tenant isolation in the data model and authorization checks.
