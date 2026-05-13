# Optional Artifact Object Storage

## Status

Draft

## Problem

Runs already produce durable artifact metadata, but large or binary outputs do not fit well in Postgres or event payloads. Screenshots, generated images, diagnostic bundles, large logs, and reports need durable storage that can be displayed in the web UI, downloaded by users, and referenced from integrations without bloating the primary database.

The system also needs to remain easy to run locally. Local development should not require a cloud bucket, and production deployments should not be locked to one object storage vendor.

## Goals

- Add optional object storage for artifact blobs while keeping Postgres as the source of truth for artifact metadata.
- Support user-facing artifact previews and downloads from the session UI.
- Keep local development simple through a `docker-compose` service or an explicitly configured filesystem fallback.
- Prefer an S3-compatible storage contract so deployments can use AWS S3, Cloudflare R2, Tigris, Garage, SeaweedFS, MinIO, or compatible platform storage.
- Make object storage disabled by default unless the deployment opts in.

## Non-Goals

- Building a general file manager or arbitrary user upload system.
- Replacing Postgres artifact rows, events, callbacks, or session history with object storage.
- Guaranteeing permanent public URLs for artifacts.
- Full-text search inside logs, archives, or exported sessions.
- Cross-region replication, lifecycle policies, malware scanning, or DLP in the first version.
- Downloadable session export bundles.

## Users / Use Cases

- Operators reviewing a run need to view screenshots, reports, and large logs from the session detail page.
- Users need to download a generated file or diagnostic bundle after a run completes.
- Integrations need stable artifact references to include in completion callbacks, Slack replies, or GitHub comments.
- Developers need to test artifact upload, preview, and download flows locally without creating a cloud bucket.
- Self-hosters need to bring their own object storage and avoid vendor-specific APIs.

## Requirements

- Artifact metadata remains stored in Postgres using the existing `artifacts` table, with `storage_key`, `url`, `type`, `title`, and `payload` identifying how to retrieve and display the artifact.
- Blob storage is optional. If object storage is not configured, existing external-link artifacts continue to work and blob-producing features should fail clearly or use an explicitly configured local fallback.
- The storage adapter should expose provider-neutral operations for `put`, `get`, `delete` when needed, and short-lived signed read URLs.
- Artifact reads through the product API remain protected by the same session auth as `GET /sessions/:sessionId/artifacts`.
- The browser should not need direct permanent bucket credentials.
- Artifacts should include content metadata when available: file name, content type, byte size, checksum, previewability, and retention hint.
- Image artifacts should be previewable in the session UI when the content type is browser-safe.
- Large text/log artifacts should be downloadable in the first version; inline preview can be capped or deferred.
- Local development should provide one documented path for object storage via `docker-compose` and one no-service fallback if practical.

## Local Development Storage Options

- Recommended default: SeaweedFS S3 API in `docker-compose` for local development. It is lightweight, S3-compatible enough for artifact flows, Apache-2.0 licensed, and avoids MinIO's current licensing concerns.
- Secondary option: Garage for teams that want a production-capable self-hosted S3-compatible store. It is active and simple to operate, but its AGPL license may have the same adoption concerns as MinIO for some users.
- Test-only option: LocalStack S3 or Adobe S3Mock for automated tests that need S3 behavior but not production-like storage. These are useful for CI, but should not be documented as production storage.
- Compatibility option: MinIO remains useful because it is the most common S3-compatible local target, but it should not be the only documented path given licensing, project direction, and patching concerns.
- Fallback option: local filesystem storage behind the same artifact adapter. This is the simplest single-process development path, but it should be documented as non-production unless paired with shared persistent volumes and single-replica assumptions.

## Product Behavior

- Session artifacts list shows artifact title, type, creation time, source run/message, size when known, and an action to view or download.
- Image-like artifacts open inline or in a preview panel.
- File, report, archive, and log artifacts expose download links generated on demand.
- External-link artifacts keep their current behavior and are visually distinguished from internally stored blobs.
- If a stored artifact is unavailable, the UI shows a clear unavailable state rather than a broken link.
- Completion callbacks may include artifact metadata and API URLs, but should avoid long-lived public signed URLs unless explicitly configured.

## Future Work

- Add archive-aware artifact retention cleanup. Archiving a session should not immediately delete artifact blobs, but a later cleanup job can delete stored blobs after a configurable retention window, preserve artifact metadata, mark expired artifacts as unavailable, and have download/preview routes return a stable expired response.

## Acceptance Criteria

- With object storage disabled, existing artifact listing and external-link artifacts continue to work.
- With local object storage enabled, a run can create a blob artifact, store it outside Postgres, list it through the session artifacts API, and download it through an authenticated API flow.
- Local development documentation includes a working `docker-compose` object storage service and required environment variables.
- No permanent object storage credentials are exposed to the browser, event payloads, callbacks, or logs.
- Artifact metadata in Postgres is sufficient to render artifact lists even if object storage is temporarily unavailable.
- The session UI can preview at least browser-safe image artifacts and download all stored artifact types.
- Tests cover disabled storage, successful upload/download, auth-protected reads, and missing-object behavior.

## Open Questions

- Should the first implementation include filesystem storage, or should local development always use an S3-compatible service?
- Should internally stored artifact downloads proxy through the API, redirect to short-lived signed URLs, or support both by configuration?
- What retention policy should apply to artifacts by default?
- Should logs be captured continuously as artifacts during a run, or only emitted by the runner at completion?
- Do callbacks need durable API download URLs, short-lived signed URLs, or only artifact IDs?

## Links

- Related issues:
- Related specs:
- Related decisions:
