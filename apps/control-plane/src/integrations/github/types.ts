export type GitHubRepository = {
  owner: string;
  repo: string;
};

export type GitHubInstallationToken = {
  token: string;
  expiresAt: Date;
  installationId: number;
};

export type GitHubInstallationRepository = GitHubRepository & {
  id: number;
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
};

export type GitHubRepositoryAccess = GitHubRepository & {
  provider: 'github';
  cloneUrl: string;
  expiresAt: Date;
  auth: {
    type: 'bearer';
    token: string;
  };
};
