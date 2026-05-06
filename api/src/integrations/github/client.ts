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

  async createInstallationAccessToken(input: { installationId: number; appJwt: string }): Promise<{ token: string; expiresAt: Date }> {
    const body = await this.request<{ token?: string; expires_at?: string }>(`/app/installations/${input.installationId}/access_tokens`, {
      method: 'POST',
      token: input.appJwt,
    });
    if (typeof body.token !== 'string' || !body.token) throw new Error('GitHub installation token response is missing token');
    if (typeof body.expires_at !== 'string' || !body.expires_at) throw new Error('GitHub installation token response is missing expires_at');
    return { token: body.token, expiresAt: new Date(body.expires_at) };
  }

  private async request<T>(path: string, input: { method: string; token: string }): Promise<T> {
    const response = await this.fetchImpl(`${this.options.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method: input.method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${input.token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    const body = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) throw new Error(`GitHub API ${input.method} ${path} failed with ${response.status}: ${body.message ?? 'unknown_error'}`);
    return body;
  }
}
