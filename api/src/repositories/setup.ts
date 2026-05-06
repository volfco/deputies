import type { NormalizedEvent } from '../events/types.js';
import type { GitHubRepository, GitHubRepositoryAccess } from '../integrations/github/types.js';
import type { SandboxHandle } from '../sandbox/types.js';

export type RepositoryAccessProvider = {
  getRepositoryAccess(repository: GitHubRepository): Promise<GitHubRepositoryAccess>;
};

export type RepositorySetupInput = {
  context: Record<string, unknown>;
  sandbox: SandboxHandle;
  sessionId: string;
  runId: string;
  messageId: string;
  emit: (event: NormalizedEvent) => Promise<void>;
};

export class RepositorySetupService {
  constructor(private readonly github?: RepositoryAccessProvider) {}

  async setup(input: RepositorySetupInput): Promise<SandboxHandle> {
    const repository = parseRepositoryContext(input.context);
    if (!repository) return input.sandbox;
    if (repository.provider !== 'github') throw new RepositorySetupError('unsupported_repository_provider', `Unsupported repository provider: ${repository.provider}`);
    if (!this.github) throw new RepositorySetupError('repository_access_unavailable', 'GitHub repository access is not configured');

    const access = await this.github.getRepositoryAccess({ owner: repository.owner, repo: repository.repo });
    const workspacePath = joinPath(input.sandbox.workspacePath, access.repo);
    await cloneOrFetchRepository(input.sandbox, access, workspacePath);
    await input.emit({
      sessionId: input.sessionId,
      runId: input.runId,
      messageId: input.messageId,
      type: 'repository_ready',
      payload: { provider: access.provider, owner: access.owner, repo: access.repo, workspacePath, expiresAt: access.expiresAt.toISOString() },
      createdAt: new Date(),
    });

    return { ...input.sandbox, workspacePath };
  }
}

export class RepositorySetupError extends Error {
  constructor(
    readonly code: 'unsupported_repository_provider' | 'repository_access_unavailable' | 'invalid_repository_context',
    message: string,
  ) {
    super(message);
  }
}

type RepositoryContext = GitHubRepository & { provider: 'github' };

export function parseRepositoryContext(context: Record<string, unknown>): RepositoryContext | null {
  const direct = parseRepositoryValue(context.repository);
  if (direct) return direct;

  const github = context.github;
  if (!isRecord(github)) return null;
  return parseRepositoryValue(github.repository);
}

async function cloneOrFetchRepository(sandbox: SandboxHandle, access: GitHubRepositoryAccess, workspacePath: string): Promise<void> {
  const result = await sandbox.exec({
    command: [
      'set -eu',
      `mkdir -p ${quoteShell(parentPath(workspacePath))}`,
      `if [ -d ${quoteShell(joinPath(workspacePath, '.git'))} ]; then`,
      `  git -C ${quoteShell(workspacePath)} remote set-url origin ${quoteShell(access.cloneUrl)}`,
      `  git -c http.extraHeader="$GITHUB_AUTH_HEADER" -C ${quoteShell(workspacePath)} fetch --prune origin`,
      'else',
      `  git -c http.extraHeader="$GITHUB_AUTH_HEADER" clone -- ${quoteShell(access.cloneUrl)} ${quoteShell(workspacePath)}`,
      'fi',
    ].join('\n'),
    env: { GITHUB_AUTH_HEADER: `AUTHORIZATION: bearer ${access.auth.token}` },
  });

  if (result.exitCode !== 0) {
    throw new Error(`Repository setup failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
}

function parseRepositoryValue(value: unknown): RepositoryContext | null {
  if (!isRecord(value)) return null;
  const provider = typeof value.provider === 'string' ? value.provider : 'github';
  const owner = typeof value.owner === 'string' ? value.owner.trim() : '';
  const repo = typeof value.repo === 'string' ? value.repo.trim() : '';
  if (!owner && !repo) return null;
  if (provider !== 'github' || !owner || !repo) {
    throw new RepositorySetupError('invalid_repository_context', 'Expected repository context with provider, owner, and repo');
  }
  return { provider, owner, repo };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function joinPath(base: string, child: string): string {
  return `${base.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
