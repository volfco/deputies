# Flue Background Agents Implementation Plan

This directory defines the implementation plan for a portable background-agent system built on top of [Flue](https://github.com/withastro/flue).

The goal is a deployable background coding-agent service that can start as a single modular Node service, then split into separate API and worker services without changing the core architecture. The design must not depend on one cloud provider's primitives. Railway, ECS Fargate + RDS, and Kubernetes should all be viable deployment targets.

## Documents

- [Architecture](./architecture.md): system shape, deployable units, module boundaries, and dependency rules.
- [Data Model](./data-model.md): Postgres-backed sessions, messages, events, runs, sandboxes, integrations, and artifacts.
- [Sandbox Providers](./sandbox-providers.md): provider contract, lifecycle APIs, capabilities, and conformance expectations.
- [Flue Persistence](./flue-persistence.md): Postgres-backed Flue session store and how it relates to product session state.
- [Integrations](./integrations.md): generic webhook, GitHub, Slack, Linear, callbacks, auth, and external thread mapping.
- [Testing Strategy](./testing-strategy.md): unit, integration, e2e, UAT, adversarial, prompt/context, and emulator-backed tests.
- [Prior Art](./prior-art.md): comparison with Open-Inspect/background-agents and Open SWE, including what to adopt or avoid.
- [Roadmap](./roadmap.md): phased implementation sequence and acceptance criteria.

## Core Principles

1. Flue is the agent harness, not the whole product.
2. The control plane uses portable primitives: Node, Postgres, HTTP, SSE/WebSockets, and S3-compatible object storage.
3. One deployable service comes first. Module boundaries must still allow later API/worker split.
4. Durable state lives in Postgres, not memory or cloud-specific actors.
5. Integrations are thin ingress/egress adapters. They never run agents directly.
6. Sandboxes are provider-backed through a stable interface.
7. Events are append-only and replayable. Streaming is delivery, not storage.
8. Tests define product behavior. Do not weaken tests to match accidental current behavior.
9. Agent context is production code. Prompt templates, skills, roles, and constraints need tests.
10. Trust is layered: permissions, conventions, lifecycle gates, tests, and review pipelines.

## Design Synthesis

The implementation should combine the strongest portable ideas from the reference systems:

```txt
Open-Inspect-style durable sessions/events/artifacts
+ Open SWE-style source normalization/follow-up/token patterns
+ Flue runner adapter
+ portable Node/Postgres deployment model
+ provider-neutral sandbox interface
```

This means product state lives in our Postgres-backed control plane, Flue is isolated behind `runner-flue`, external systems normalize into a common message envelope, and sandbox providers plug in through a conformance-tested interface. Cloud/provider-specific capabilities such as snapshots, stop/start, WebSocket bridges, or object storage are optional optimizations rather than correctness requirements.

## MVP Target

The first complete version should support:

- Single service process with `RUN_MODE=all`.
- Postgres-backed sessions, messages, events, runs, and leases.
- Generic inbound webhook integration.
- Fake runner and fake sandbox for deterministic tests.
- Flue runner behind an adapter interface.
- One real sandbox provider.
- SSE event streaming with cursor replay.
- UAT suite against the built app artifact.

GitHub, Slack, and Linear should be added after the core session/message/worker loop is proven.
