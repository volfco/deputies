# Deployment Configurations

This directory contains deployment-specific configuration for running Deputies outside the pnpm development workflow.

Deployable source and shared Dockerfiles live under `apps/`:

- `apps/api/`: API and worker service, including `apps/api/Dockerfile`.
- `apps/web/`: static web UI build, including `apps/web/Dockerfile`.

Deployment target docs:

- `local/`: local production-style Docker Compose stack.

Add one subdirectory per deployment target or infrastructure provider, for example:

- `railway/`
- `docker/`
- `k8s/`
- `terraform/`

Keep provider-specific secrets out of this directory. Document required environment variables in the relevant subdirectory README instead.
