import { createPreviewTool } from '../../src/runner-flue/preview-tool.js';

describe('preview tool', () => {
  it('publishes, lists, and unpublishes previews in session context', async () => {
    let context: Record<string, unknown> = {};
    const tool = createPreviewTool({
      sessionId: 'session-1',
      getContext: () => context,
      setContext: (next) => {
        context = next;
      },
      async updateSessionContext(next) {
        context = next;
        return context;
      },
    });

    await expect(
      tool.execute({ action: 'publish', port: 5173, label: 'Vite app', path: '/dashboard' }),
    ).resolves.toBe(JSON.stringify({ previews: [{ port: 5173, label: 'Vite app', path: '/dashboard' }] }));
    await expect(tool.execute({ action: 'list' })).resolves.toBe(
      JSON.stringify({ previews: [{ port: 5173, label: 'Vite app', path: '/dashboard' }] }),
    );
    await expect(tool.execute({ action: 'unpublish', port: 5173 })).resolves.toBe(JSON.stringify({ previews: [] }));
  });
});
