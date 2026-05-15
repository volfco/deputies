import type { GitHubInstallationRepository } from './types.js';

export type GitHubClientOptions = {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
};

export class GitHubClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getRepositoryInstallation(input: { owner: string; repo: string; appJwt: string }): Promise<{ id: number }> {
    const body = await this.request<{ id?: number }>(`/repos/${input.owner}/${input.repo}/installation`, {
      method: 'GET',
      token: input.appJwt,
    });
    if (typeof body.id !== 'number') throw new Error('GitHub repository installation response is missing id');
    return { id: body.id };
  }

  async createInstallationAccessToken(input: {
    installationId: number;
    appJwt: string;
    repositories?: string[];
  }): Promise<{ token: string; expiresAt: Date }> {
    const body = await this.request<{ token?: string; expires_at?: string }>(
      `/app/installations/${input.installationId}/access_tokens`,
      {
        method: 'POST',
        token: input.appJwt,
        ...(input.repositories?.length ? { json: { repositories: input.repositories } } : {}),
      },
    );
    if (typeof body.token !== 'string' || !body.token)
      throw new Error('GitHub installation token response is missing token');
    if (typeof body.expires_at !== 'string' || !body.expires_at)
      throw new Error('GitHub installation token response is missing expires_at');
    return { token: body.token, expiresAt: new Date(body.expires_at) };
  }

  async listAppInstallations(input: { appJwt: string }): Promise<Array<{ id: number }>> {
    const installations: Array<{ id: number }> = [];
    for (let page = 1; ; page += 1) {
      const body = await this.request<Array<{ id?: number }>>(`/app/installations?per_page=100&page=${page}`, {
        method: 'GET',
        token: input.appJwt,
      });
      installations.push(
        ...body.flatMap((installation) => (typeof installation.id === 'number' ? [{ id: installation.id }] : [])),
      );
      if (body.length < 100) return installations;
    }
  }

  async listInstallationRepositories(input: { token: string }): Promise<GitHubInstallationRepository[]> {
    const repos: GitHubInstallationRepository[] = [];
    for (let page = 1; ; page += 1) {
      const body = await this.request<{
        repositories?: Array<{
          id?: number;
          name?: string;
          full_name?: string;
          description?: string | null;
          private?: boolean;
          default_branch?: string;
          owner?: { login?: string };
        }>;
      }>(`/installation/repositories?per_page=100&page=${page}`, { method: 'GET', token: input.token });
      const pageRepos = body.repositories ?? [];
      repos.push(
        ...pageRepos.flatMap((repo) => {
          if (
            typeof repo.id !== 'number' ||
            typeof repo.name !== 'string' ||
            typeof repo.full_name !== 'string' ||
            typeof repo.owner?.login !== 'string'
          ) {
            return [];
          }
          return [
            {
              id: repo.id,
              owner: repo.owner.login,
              repo: repo.name,
              fullName: repo.full_name,
              description: repo.description ?? null,
              private: Boolean(repo.private),
              defaultBranch: repo.default_branch ?? 'main',
            },
          ];
        }),
      );
      if (pageRepos.length < 100) return repos;
    }
  }

  async listBranches(input: { owner: string; repo: string; token: string }): Promise<Array<{ name: string }>> {
    const branches: Array<{ name: string }> = [];
    for (let page = 1; ; page += 1) {
      const body = await this.request<Array<{ name?: string }>>(
        `/repos/${input.owner}/${input.repo}/branches?per_page=100&page=${page}`,
        { method: 'GET', token: input.token },
      );
      branches.push(...body.flatMap((branch) => (typeof branch.name === 'string' ? [{ name: branch.name }] : [])));
      if (body.length < 100) return branches;
    }
  }

  async createIssueComment(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
    body: string;
  }): Promise<{ id: number; htmlUrl?: string }> {
    const body = await this.request<{ id?: number; html_url?: string }>(
      `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`,
      {
        method: 'POST',
        token: input.token,
        json: { body: input.body },
      },
    );
    if (typeof body.id !== 'number') throw new Error('GitHub issue comment response is missing id');
    return { id: body.id, ...(typeof body.html_url === 'string' ? { htmlUrl: body.html_url } : {}) };
  }

  async createReaction(input: {
    owner: string;
    repo: string;
    path: string;
    token: string;
    content: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes';
  }): Promise<void> {
    await this.request<Record<string, unknown>>(
      `/repos/${input.owner}/${input.repo}/${input.path.replace(/^\//, '')}/reactions`,
      {
        method: 'POST',
        token: input.token,
        json: { content: input.content },
      },
    );
  }

  async listIssueComments(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
  }): Promise<
    Array<{ id: number; body: string; author?: string; authorType?: string; createdAt?: string; htmlUrl?: string }>
  > {
    const comments = await this.request<
      Array<{
        id?: number;
        body?: string;
        user?: { login?: string; type?: string };
        created_at?: string;
        html_url?: string;
      }>
    >(`/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments?per_page=100`, {
      method: 'GET',
      token: input.token,
    });
    return comments.flatMap((comment) => {
      if (typeof comment.id !== 'number') return [];
      return [
        {
          id: comment.id,
          body: typeof comment.body === 'string' ? comment.body : '',
          ...(typeof comment.user?.login === 'string' ? { author: comment.user.login } : {}),
          ...(typeof comment.user?.type === 'string' ? { authorType: comment.user.type } : {}),
          ...(typeof comment.created_at === 'string' ? { createdAt: comment.created_at } : {}),
          ...(typeof comment.html_url === 'string' ? { htmlUrl: comment.html_url } : {}),
        },
      ];
    });
  }

  private async request<T>(
    path: string,
    input: { method: string; token: string; json?: Record<string, unknown> },
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.options.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method: input.method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${input.token}`,
        ...(input.json ? { 'content-type': 'application/json' } : {}),
        'x-github-api-version': '2022-11-28',
      },
      ...(input.json ? { body: JSON.stringify(input.json) } : {}),
    });
    const body = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) throw new GitHubApiError(input.method, path, response.status, body.message ?? 'unknown_error');
    return body;
  }
}

export class GitHubApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly statusCode: number,
    readonly githubMessage: string,
  ) {
    super(`GitHub API ${method} ${path} failed with ${statusCode}: ${githubMessage}`);
  }
}
