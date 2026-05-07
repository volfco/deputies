import { createGitTool, type AgentRef } from '../../src/runner-flue/git-tool.js';
import type { GitHubRepositoryAccess } from '../../src/integrations/github/types.js';

describe('authenticated git Flue tool', () => {
  it('runs git inside the sandbox repo with command-scoped auth', async () => {
    const shells: Array<{ command: string; cwd?: string; env?: Record<string, string> }> = [];
    const agentRef: AgentRef = {
      current: {
        async session() { throw new Error('not used'); },
        async shell(command, options) {
          const shell: { command: string; cwd?: string; env?: Record<string, string> } = { command };
          if (options?.cwd) shell.cwd = options.cwd;
          if (options?.env) shell.env = options.env;
          shells.push(shell);
          return { exitCode: 0, stdout: 'pushed', stderr: '' };
        },
      },
    };
    const tool = createGitTool({ access, workspacePath: '/workspace/manaflow', agentRef });

    const result = await tool.execute({ args: ['push', 'origin', 'sp/test'] });

    expect(result).toBe('exitCode: 0\nstdout:\npushed');
    expect(shells).toEqual([{ command: "git -c http.extraHeader=\"$GITHUB_AUTH_HEADER\" 'push' 'origin' 'sp/test'", cwd: '/workspace/manaflow', env: {
      GITHUB_AUTH_HEADER: `Authorization: Basic ${Buffer.from('x-access-token:ghs_secret_token').toString('base64')}`,
    } }]);
  });

  it('rejects executable names and top-level flags', async () => {
    const tool = createGitTool({ access, workspacePath: '/workspace/manaflow', agentRef: {} });

    await expect(tool.execute({ args: ['git', 'push'] })).rejects.toThrow('omit the git executable name');
    await expect(tool.execute({ args: ['-c', 'http.extraHeader=bad', 'push'] })).rejects.toThrow('explicit subcommand');
  });
});

const access: GitHubRepositoryAccess = {
  provider: 'github',
  owner: 'manaflow-ai',
  repo: 'manaflow',
  cloneUrl: 'https://github.com/manaflow-ai/manaflow.git',
  expiresAt: new Date('2026-05-06T01:00:00.000Z'),
  auth: { type: 'bearer', token: 'ghs_secret_token' },
};
