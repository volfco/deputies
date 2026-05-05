# Roadmap

## Phase 0: Repository And Agent Context

Goal: make the codebase agent-ready before implementation accelerates.

Deliverables:

- `AGENTS.md` with project-wide conventions.
- `agent-constraints/planning.md`.
- `agent-constraints/adversarial-review.md`.
- `agent-constraints/implementation.md`.
- `agent-constraints/testing.md`.
- Architecture docs for module boundaries.
- Initial package/project scaffold.

Acceptance criteria:

- An agent can read one entry point and understand the intended module boundaries.
- The testing rules are explicit before production code exists.

## Phase 1: Core Service Scaffold

Goal: create the modular monolith skeleton.

Deliverables:

- Node service bootstrap.
- Config parser with `RUN_MODE`.
- Health endpoint.
- Store module with Postgres connection.
- Migration runner.
- Test harness for app + Postgres.
- Architecture fitness tests.

Acceptance criteria:

- `RUN_MODE=all`, `RUN_MODE=api`, and `RUN_MODE=worker` are parseable.
- Health endpoint works.
- Integration test can start app with test Postgres.
- Architecture tests prevent forbidden imports.

## Phase 2: Sessions, Messages, Events

Goal: implement durable intent and replayable observability.

Deliverables:

- `sessions` module.
- `messages` module.
- `events` module.
- Postgres schema and migrations.
- API routes:
  - `POST /sessions`
  - `GET /sessions/:id`
  - `POST /sessions/:id/messages`
  - `GET /sessions/:id/events`
  - `GET /sessions/:id/events/stream`
- Contract schemas for API responses and events.

Acceptance criteria:

- Creating a session writes a `session_created` event.
- Appending a message writes a `message_created` event.
- Event replay by cursor works.
- SSE stream receives appended events.

## Phase 3: Worker, Runs, Leases

Goal: execute pending messages safely and portably.

Deliverables:

- `runs` module.
- Worker loop.
- Message claiming with `FOR UPDATE SKIP LOCKED`.
- Session run lease.
- Lease heartbeat and stale lease recovery.
- Fake runner.
- Fake sandbox provider.

Acceptance criteria:

- Worker processes pending messages using fake runner.
- Concurrent workers do not process the same message twice.
- Stale processing messages recover.
- Failed runner marks message/run failed and emits failure event.

## Phase 4: Generic Webhook Integration

Goal: support arbitrary external systems before specialized integrations.

Deliverables:

- Generic webhook source config.
- Bearer auth.
- Mapping config.
- Filter config.
- Prompt template rendering.
- Dedupe handling.
- Route: `POST /webhooks/generic/:sourceKey`.

Acceptance criteria:

- Valid webhook creates or reuses session and appends message.
- Invalid auth returns `401`.
- Duplicate delivery is ignored.
- Filtered-out payload does not create a message.
- Rendered prompt includes source, repo, request, and payload context.

## Phase 5: Flue Runner Adapter

Goal: connect real Flue execution behind the runner interface.

Deliverables:

- `runner-flue` module.
- Postgres-backed Flue session store.
- Flue initialization from session/message context.
- Event normalization from Flue events to internal events.
- Prompt builder integration.
- Fake and real runner selectable by config.

Acceptance criteria:

- Only `runner-flue` imports `@flue/sdk`.
- Flue session history survives process restart.
- Fake runner remains default in deterministic tests.
- Real Flue runner can execute a minimal prompt in a controlled sandbox.
- Flue text/tool/task events are persisted as normalized events.

## Phase 6: Sandbox Provider

Goal: execute coding tasks in an isolated environment through a provider abstraction.

Deliverables:

- Sandbox provider interface.
- Sandbox lifecycle manager.
- Fake provider for tests.
- One real provider, selected from Daytona, local Docker, Kubernetes, or ECS.
- Health checks.
- Provider metadata persistence.

Acceptance criteria:

- Worker ensures sandbox exists before running.
- Existing sandbox can be reconnected by provider ID.
- Unhealthy sandbox fails clearly or is recreated according to policy.
- Tests use fake provider without real infrastructure.

## Phase 7: UAT Suite

Goal: test the built artifact as users and deploy platforms will run it.

Deliverables:

- Build command.
- UAT harness that starts compiled server.
- UAT Postgres setup.
- HTTP acceptance tests.
- Emulator-backed GitHub/Slack/AWS setup if relevant tests exist.

Acceptance criteria:

- Built artifact passes health/session/message/event/generic webhook UAT.
- JSON response schemas are validated.
- User-facing errors are stable and useful.

## Phase 8: GitHub Integration

Goal: support issue/PR mention workflows with emulator-backed confidence.

Deliverables:

- GitHub webhook route.
- Signature verification.
- Delivery dedupe.
- Mention detection.
- Issue/PR context fetching.
- GitHub callback posting.
- GitHub App token support.
- Emulate-backed integration tests.

Acceptance criteria:

- Issue comment mention creates message.
- PR comment mention creates or reuses session.
- Duplicate delivery is ignored.
- Completion posts comment to emulated GitHub.
- Prompt wraps GitHub content as untrusted.

## Phase 9: Slack Integration

Goal: support Slack app mention and thread follow-up workflows.

Deliverables:

- Slack event route.
- Signature verification.
- URL verification challenge.
- Event dedupe.
- Thread-to-session mapping.
- Slack callback posting.
- Emulate-backed integration tests.

Acceptance criteria:

- App mention creates message.
- Thread follow-up maps to existing session.
- Bot messages are ignored.
- Completion posts thread reply in emulated Slack.

## Phase 10: Linear Integration

Goal: support Linear issue workflows.

Deliverables:

- Linear webhook route.
- Signature verification.
- Delivery dedupe.
- Issue-to-session mapping.
- Repo resolution rules.
- Linear callback/activity posting.
- Local fake Linear integration tests.

Acceptance criteria:

- Mention or assignment creates message.
- Follow-up comments map to existing session.
- Completion links session and PR artifact.
- Signature failure returns `401`.

## Phase 11: Deployment Targets

Goal: prove portability.

Deliverables:

- Railway deployment guide.
- ECS Fargate + RDS deployment guide.
- Kubernetes deployment guide.
- Dockerfile.
- Runtime env var reference.
- Migration/runbook docs.

Acceptance criteria:

- Same artifact runs on all targets.
- Only environment/config differs.
- No core code path depends on one platform-specific primitive.

## Phase 12: Agent Workflow Hardening

Goal: make agent-driven development compound.

Deliverables:

- Prompt/context snapshot tests.
- Promptfoo-style evals for skills/roles if used.
- Adversarial review prompt and checklist.
- CI change detection for docs/prompts/integrations.
- Optional AI review pipeline later.

Acceptance criteria:

- Changes to prompt templates require tests.
- Changes to module boundaries fail architecture tests if they drift.
- New integrations include emulator/fake-backed tests.
- New sandbox providers include conformance tests.
