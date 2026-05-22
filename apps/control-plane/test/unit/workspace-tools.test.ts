import { workspaceTool } from '../../src/app/workspace-tools.js';

describe('workspace tools', () => {
  it('opens Hunk Diff as a one-shot diff viewer', () => {
    const tool = workspaceTool('diff');

    expect(tool?.command).toContain('command hunk diff');
    expect(tool?.command).toContain('git status --porcelain --untracked-files=normal');
    expect(tool?.command).not.toContain('--watch');
    expect(tool?.command).not.toContain('--exclude-untracked');
  });
});
