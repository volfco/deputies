# Prior Art: Open-Inspect And Open SWE

This document compares the portable Flue background-agent design with two reference systems:

- `background-agents-upstream`, also referred to as Open-Inspect in its docs.
- `open-swe-upstream`, the LangGraph/Deep Agents implementation.

The goal is not to copy either system directly. The goal is to adopt the durable patterns that fit a portable, provider-neutral Flue implementation.

## Summary Comparison

| Area | This Design | Open-Inspect / background-agents | Open SWE |
|---|---|---|---|
| Harness | Flue behind runner adapter | OpenCode in sandbox runtime | Deep Agents / LangGraph |
| Control plane | Portable Node service + Postgres | Cloudflare Workers + Durable Objects + D1/KV | LangGraph server/webapp + thread metadata/store |
| Deployment target | Railway, ECS, Kubernetes, local | Cloudflare + Modal/Daytona | LangSmith/LangGraph oriented, pluggable sandboxes |
| Session state | Postgres tables | Durable Object SQLite per session + D1 shared state | LangGraph thread state and metadata |
| Queueing | Postgres messages + leases | DO-local message queue | LangGraph store queue for busy threads |
| Events | Append-only Postgres event log + SSE | DO event table + WebSocket fanout | Agent/tool stream plus source replies |
| Sandbox abstraction | Provider interface + capabilities | Provider lifecycle manager for Modal/Daytona | Sandbox backend protocol selected by env |
| Runtime bridge | Optional, provider-dependent | Required sandbox bridge/supervisor | Provider-specific backend wrappers |
| Integrations | Thin adapters to common envelope | Slack/GitHub/Linear bots call control plane | Webhooks normalize into LangGraph thread IDs |
| Testing | Agent-first layered tests + emulate | Strong production code, infra-specific tests/docs | Python tests around utility/webhook behavior |

## What We Should Adopt From Open-Inspect

### 1. Session As The Core Actor

Open-Inspect is built around a durable session object. A session owns messages, events, artifacts, sandbox state, participants, and WebSocket subscribers.

Adopt the concept, not the Cloudflare implementation.

In this design:

- Durable Object becomes Postgres-backed session state.
- DO-local SQLite becomes regular Postgres tables.
- WebSocket hibernation becomes replayable event cursors.
- Per-session actor exclusivity becomes Postgres leases.

### 2. Append-Only Events With Replay

Open-Inspect treats events as durable state and broadcasts them to connected clients.

Adopt:

- Store events before broadcasting.
- Give every session event a cursor/sequence.
- Allow clients to reconnect and replay.
- Treat SSE/WebSocket as delivery only.

This is already reflected in `events` and `GET /sessions/:id/events/stream`.

### 3. Message Queue Decoupled From Active Connections

Open-Inspect can keep running after the user disconnects. Client presence is not required for progress.

Adopt:

- API requests append durable messages.
- Workers process messages asynchronously.
- Follow-ups queue while a session is busy.
- Clients can close and later inspect events/artifacts.

### 4. Sandbox Supervisor + Bridge Split

Open-Inspect separates sandbox supervision from protocol bridging:

- Supervisor owns repo setup, processes, dev server, and runtime lifecycle.
- Bridge owns control-plane connection, commands, event translation, buffering, and ACKs.

Adopt selectively:

- For providers with poor native exec/filesystem APIs, use a bridge.
- Keep provider lifecycle and runner protocol separate.
- Do not require the bridge for every provider.

This is most relevant for ECS and Kubernetes.

### 5. Provider Lifecycle Manager

Open-Inspect has a lifecycle layer that decides when to create, restore, stop, snapshot, or mark sandboxes stale.

Adopt:

- Provider interface.
- Provider capability flags.
- Separate lifecycle policy from provider API calls.
- Health checks and stale sandbox recovery.
- Snapshots as optimization, not core correctness.

### 6. Thin Integrations

Open-Inspect's Slack/GitHub/Linear integrations are mostly webhook-to-session translators.

Adopt:

- Verify signatures.
- Dedupe deliveries.
- Normalize source context.
- Map external thread to session.
- Enqueue message.
- Let the worker/runner do the actual agent work.

### 7. Shared Protocol Types

Open-Inspect has shared session and event contracts used by clients, control plane, and sandbox runtime.

Adopt:

- One canonical event schema.
- One canonical integration envelope.
- One canonical sandbox provider contract.
- Contract tests for these schemas.

### 8. Callback Contexts

Open-Inspect keeps enough source context to notify Slack/Linear/GitHub when work progresses or completes.

Adopt:

- Store message callback targets.
- Drive outbound callbacks from normalized internal events.
- Keep callbacks sparse by default.

## What We Should Avoid From Open-Inspect

### 1. Cloudflare-Specific Control Plane As A Requirement

Open-Inspect's core design is tightly aligned with Cloudflare Durable Objects, D1, and KV.

Avoid as mandatory infrastructure.

Use:

- Postgres for state.
- Postgres leases for actor-like exclusivity.
- SSE/WebSocket replay from the event log.

### 2. Modal-First Assumptions

Open-Inspect gets a lot from Modal snapshots and fast starts.

Avoid making snapshots or Modal semantics required.

Use provider capabilities instead.

### 3. WebSocket As The Primary Persistence Boundary

Open-Inspect has a sophisticated sandbox WebSocket protocol.

Avoid requiring long-lived bidirectional sockets for every provider.

Use bridges where helpful, but let providers implement direct APIs when simpler.

## What We Should Adopt From Open SWE

### 1. Deterministic External Thread IDs

Open SWE maps Slack, Linear, and GitHub source objects to deterministic thread IDs.

Adopt:

```txt
slack:team:channel:thread_ts
github:owner/repo:issue:123
github:owner/repo:pr:456
linear:issue_id
webhook:source_key:external_thread_id
```

This makes follow-ups route predictably to the same session.

### 2. Busy Thread Follow-Up Queue

Open SWE does not start duplicate agents when a thread is already busy. It queues follow-up messages and injects them before the next model call.

Adopt:

- Same-session follow-ups queue in `messages`.
- Worker enforces one active run per session.
- Later, `runner-flue` can inject queued follow-ups at safe turn boundaries if Flue exposes a clean hook.
- Until then, process queued follow-ups after the active run completes.

### 3. Pluggable Sandbox Backend

Open SWE selects sandbox providers through a common backend protocol.

Adopt:

- Provider abstraction.
- Reconnect by persisted sandbox ID.
- Health check before reuse.
- Recreate when unreachable according to policy.

Flue's documented Daytona coding-agent example is also directly relevant. It shows a two-stage pattern: first initialize a setup agent in the sandbox to clone/install, then initialize a project-scoped agent with the same sandbox and `cwd` set to the cloned repo. We should adopt that orchestration pattern in `runner-flue`, adding durable sandbox records and reconnect/reuse policy around it.

### 4. GitHub App Token Handling

Open SWE mints GitHub App installation tokens and avoids blindly storing real tokens in the sandbox when possible.

Adopt:

- Runtime GitHub App installation token minting.
- Store credential references or encrypted payloads, not raw tokens in events/messages.
- Prefer short-lived tokens.
- Redact all token material from logs and events.

### 5. Source-Specific Prompt Builders

Open SWE builds rich prompts for Slack, Linear, GitHub issues, and GitHub PRs.

Adopt:

- Common prompt safety wrapper.
- Source-specific context sections.
- Explicit untrusted-content boundaries.
- PR review context including file, line, and diff hunk.

### 6. Prompt-Driven PR Completion With Verification

Open SWE instructs the agent to create/update PRs with `gh` and to report only after success.

Adopt the verification rule, but consider moving PR creation into a first-class artifact/tool over time.

MVP options:

- Let the agent create PRs inside sandbox and detect PR URLs from output/events.
- Or expose a controlled GitHub tool for PR creation and artifact recording.

In both cases, do not claim PR success without a verified PR URL.

## What We Should Avoid From Open SWE

### 1. Thread Metadata As The Only Durable Product State

Open SWE can lean on LangGraph thread metadata and state.

Avoid making Flue session history our only system of record.

Use Postgres for product state:

- sessions
- messages
- runs
- events
- artifacts
- sandboxes
- external thread mappings

Flue history is runner state, not the whole product database.

### 2. Prompt-Only Enforcement For Critical Workflow Gates

Open SWE relies heavily on system prompts for validation, PR creation, and notification behavior.

Adopt prompts for agent guidance, but enforce critical rules in code where possible:

- one active run per session
- webhook dedupe
- token redaction
- event persistence
- verified artifact creation
- callback retry/failure handling

### 3. Provider-Specific Token Proxy As A Requirement

Open SWE's LangSmith proxy pattern is useful, but should not be required.

Adopt the goal:

- avoid leaking long-lived credentials into sandboxes.

Allow multiple implementations:

- runtime-minted env vars
- provider secret injection
- outbound proxy
- host-side controlled commands/tools

## Additional Pattern To Adopt From Both

### Normalize Early, Specialize Late

Both systems work best where external inputs are normalized before hitting the agent.

Adopt:

```txt
raw webhook -> verified source event -> IntegrationEnvelope -> message -> prompt context -> runner
```

This keeps integrations simple and makes tests easier.

### Design For Resumption

Both systems assume agent work may outlive the request that started it.

Adopt:

- every state transition is persisted.
- every run has a lease.
- every sandbox has a persisted provider ID.
- every event is replayable.
- every external thread maps to a session.

### Make Sandbox State Observable

Both systems surface sandbox lifecycle events.

Adopt event types for:

- sandbox create/connect/health.
- repo sync.
- setup/start hook.
- runner start.
- snapshot/restore if supported.
- sandbox failure.

## Net Recommendation

Use Open-Inspect as the stronger model for product/control-plane architecture, but replace its Cloudflare-specific actor model with Postgres-backed sessions, leases, and replayable events.

Use Open SWE as the stronger model for invocation normalization, deterministic thread IDs, follow-up queue behavior, GitHub App token handling, and source-specific prompt construction.

Use Flue as the agent runtime boundary, not as the entire product state model. Flue should own conversation mechanics, tools, skills, roles, tasks/subagents, live runtime events, and sandbox connector shape. The product should own durable background-work semantics, integrations, replayable product events, artifacts, queueing, leases, and operational state.

The resulting design is:

```txt
Open-Inspect-style durable sessions/events/artifacts
+ Open SWE-style source normalization/follow-up/token patterns
+ Flue runner adapter
+ portable Postgres/Node deployment model
+ provider-neutral sandbox interface
```

That combination preserves the best ideas from both systems while avoiding their deployment-specific constraints.
