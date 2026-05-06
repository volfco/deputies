# Feature Backlog

This is a living backlog for product, integration, runtime, and operations work. It is not a release commitment.

## Integrations

- Slack outbound completion replies.
- Slack authorization policy for allowed teams, channels, and users.
- Slack prompt cleanup so the deputy focuses on the request before metadata.
- Slack thread context fetching.
- Slack start/queued status acknowledgement beyond reaction-only progress.
- GitHub integration for issue comments, PR comments, and review comments.
- GitHub App signature verification, installation token flow, and delivery dedupe.
- GitHub callback comments with completion summaries and PR/artifact links.
- Linear integration for issue mentions, assignments, and comment follow-ups.
- Generic webhook mapping/filter/template configuration beyond the current simple payload shape.

## Web UI

- Session tagging, filtering, and grouping.
- User-selectable model, repository, branch, and execution settings.
- Repository picker with saved defaults per user/team/source.
- Session list pagination and server-side search.
- Pin/favorite sessions.
- Better run and sandbox status in the context panel.
- Surface sandbox cleanup events and failures more clearly.
- Show callback delivery status per session/message.
- Improve archived-session browsing and bulk cleanup.
- Playwright smoke tests for desktop/mobile flows.

## Agent Runtime

- Agent authentication to external services through MCP, CLI credentials, API tokens, and short-lived provider tokens.
- Credential scoping and injection policy for tools, commands, MCP servers, and sandbox environments.
- Multi-repository task support, including repo selection, cloning/syncing multiple worktrees, and cross-repo context.
- Callback retry tuning, observability, and manual replay controls.
- Prompt templates and snapshot tests for Slack/GitHub/Linear inputs.
- Better repo resolution from Slack/GitHub/Linear context.
- Setup/install hook observability.
- Repo sync after first clone instead of recloning.
- Upstream Flue cancellation improvement for built-in bash/tool execution.

## Sandboxes

- Local Docker provider.
- Kubernetes provider.
- ECS/Fargate provider with bridge sidecar.
- Provider conformance test suite.
- Sandbox metrics for create/connect/start/stop/destroy latency.
- Object storage integration for large logs/artifacts.

## Scale And Operations

- Multiple product users and organizations with separate auth, session ownership, quotas, and audit trails.
- Per-user/per-team integration authorization policies for Slack, GitHub, Linear, and web UI entry points.
- Metrics endpoint or structured timing logs.
- Pending-message, active-run, and worker-throughput dashboards.
- Session/event table pagination and retention policies.
- Deployment guides for Railway, ECS Fargate + RDS, and Kubernetes.
- Migration/release runbooks.
- Production readiness checklist.

## Testing

- Emulate-backed Slack callback tests in regular CI if reliable.
- Emulate-backed GitHub integration tests.
- Real-provider smoke tests for Daytona on a schedule.
- Load profiles for session listing, event replay, SSE fanout, and worker throughput.
- Contract schemas for public API responses and normalized events.
