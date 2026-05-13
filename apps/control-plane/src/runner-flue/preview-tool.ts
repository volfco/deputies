import type { ToolDef } from '@flue/sdk';
import type { RunnerInput } from '../runner/types.js';
import {
  isValidPreviewPath,
  maxPreviewLabelLength,
  maxPreviewPathLength,
  type PublishedPreview,
  readPreviews,
} from '../sessions/previews.js';

export type PreviewToolServices = {
  sessionId: string;
  providerSandboxId: string;
  updateSessionContext: NonNullable<RunnerInput['updateSessionContext']>;
  getContext: () => Record<string, unknown>;
  setContext: (context: Record<string, unknown>) => void;
};

export function createPreviewTool(services: PreviewToolServices): ToolDef {
  return {
    name: 'preview',
    description:
      'Manage live app previews visible in the product UI. Use action=publish after starting a web server in the sandbox so the user can open it. Use action=list to see published previews and action=unpublish to remove one. Publish one preview per app/port, with a user-facing label such as "Web app", "Vite dev server", or "API docs".',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['publish', 'unpublish', 'list'], description: 'Preview action to perform.' },
        port: { type: 'number', minimum: 1, maximum: 65535, description: 'TCP port the app listens on.' },
        label: { type: 'string', maxLength: maxPreviewLabelLength, description: 'Human-readable preview label.' },
        path: { type: 'string', maxLength: maxPreviewPathLength, description: 'Optional path to open, for example /docs.' },
      },
    },
    async execute(params) {
      const action = readAction(params.action);
      if (action === 'list') return JSON.stringify({ previews: readPreviews(services.getContext()) });

      const port = readPort(params.port);
      const current = readPreviews(services.getContext());
      const next = action === 'publish' ? publishPreview(current, params, port, services.providerSandboxId) : unpublishPreview(current, port);
      const context = { ...services.getContext(), previews: next };
      services.setContext(await services.updateSessionContext(context));

      return JSON.stringify({ previews: next });
    },
  };
}

function publishPreview(current: PublishedPreview[], params: Record<string, unknown>, port: number, providerSandboxId: string): PublishedPreview[] {
  const preview: PublishedPreview = { port, providerSandboxId };
  const label = readOptionalString(params.label, 'label', maxPreviewLabelLength);
  const path = readOptionalPath(params.path);
  if (label) preview.label = label;
  if (path) preview.path = path;
  return [...current.filter((item) => item.port !== port), preview].sort((a, b) => a.port - b.port);
}

function unpublishPreview(current: PublishedPreview[], port: number): PublishedPreview[] {
  return current.filter((item) => item.port !== port);
}

function readAction(value: unknown): 'publish' | 'unpublish' | 'list' {
  if (value === 'publish' || value === 'unpublish' || value === 'list') return value;
  throw new Error('preview action must be one of: publish, unpublish, list');
}

function readPort(value: unknown): number {
  if (!isValidPort(value)) throw new Error('preview port must be an integer from 1 to 65535');
  return value;
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function readOptionalString(value: unknown, name: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`preview ${name} must be a non-empty string`);
  if (value.length > maxLength) throw new Error(`preview ${name} cannot exceed ${maxLength} characters`);
  return value;
}

function readOptionalPath(value: unknown): string | undefined {
  const path = readOptionalString(value, 'path', maxPreviewPathLength);
  if (path === undefined) return undefined;
  if (!isValidPreviewPath(path)) throw new Error('preview path must start with / and cannot contain whitespace');
  return path;
}
