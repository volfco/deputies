# Product Documentation

This directory stores durable product and development documents for future reference. Use it for feature requirements, implementation specs, research notes, and product decisions that should outlive an individual issue or pull request.

## Sections

- [PRDs](./prds/): product requirements, user problems, goals, non-goals, and acceptance criteria.
- [Specs](./specs/): implementation-oriented design documents for approved or active work.
- [Research](./research/): investigations, options considered, competitive notes, and exploratory findings.
- [Decisions](./decisions/): durable product or technical decisions that future contributors should preserve.

## Naming

Prefer dated, kebab-case filenames:

```txt
YYYY-MM-DD-feature-or-topic.md
```

Examples:

```txt
prds/2026-05-12-session-tags-and-filters.md
specs/2026-05-12-session-tags-and-filters-technical-spec.md
research/2026-05-12-sandbox-provider-options.md
decisions/2026-05-12-use-postgres-for-events.md
```

## Status Values

Use one of these status values at the top of each document when applicable:

- `Draft`
- `Approved`
- `Building`
- `Shipped`
- `Superseded`
