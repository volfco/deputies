import path from 'node:path';
import type { ToolDef } from '@flue/sdk';
import type { ArtifactService } from '../artifacts/service.js';
import type { SandboxHandle } from '../sandbox/types.js';

const allowedTypes = new Set(['file', 'log', 'screenshot', 'report', 'image']);
const maxStringLength = 512;

export type ArtifactToolServices = {
  artifacts: ArtifactService;
  sandbox: SandboxHandle;
  sessionId: string;
  runId: string;
  messageId: string;
  maxBytes: number;
};

export function createArtifactTool(services: ArtifactToolServices): ToolDef {
  return {
    name: 'artifact_create',
    description:
      'Publish a file from the current sandbox as a durable artifact visible in the product UI. ' +
      'Use this for screenshots, generated images, reports, large logs, and other files the user should be able to view or download. ' +
      'Provide a sandbox file path, artifact type, and optional title/content type. Use a user-facing title such as "Generated image", "Screenshot", or "Test report", not process context like "retry attempt". Prefer kebab-case download filenames with a useful extension, such as generated-image.png, test-report.md, or run-log.txt. The tool returns an artifact ID and product download URL you can mention in your response.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'type'],
      properties: {
        path: { type: 'string', maxLength: 2_048, description: 'Path to an existing file in the sandbox.' },
        type: {
          type: 'string',
          enum: [...allowedTypes],
          description: 'Artifact type: file, log, screenshot, report, or image.',
        },
        title: { type: 'string', maxLength: maxStringLength, description: 'Human-readable title for the artifact.' },
        contentType: { type: 'string', maxLength: 128, description: 'MIME type, for example image/png or text/plain.' },
        fileName: {
          type: 'string',
          maxLength: maxStringLength,
          description: 'Download filename to show users. Prefer kebab-case with a useful extension, for example generated-image.png or run-log.txt.',
        },
      },
    },
    async execute(params) {
      const input = validateParams(params);
      if (!services.sandbox.fs) throw new Error(`Sandbox provider "${services.sandbox.provider}" does not expose files`);

      const stat = await services.sandbox.fs.stat(input.path);
      if (!stat.isFile) throw new Error('artifact_create path must point to a regular file');
      if (stat.size > services.maxBytes) {
        throw new Error(`artifact_create file exceeds max size of ${services.maxBytes} bytes`);
      }

      const body = await services.sandbox.fs.readFileBuffer(input.path);
      const fileName = input.fileName ?? path.basename(input.path);
      const artifact = await services.artifacts.createStoredArtifact({
        sessionId: services.sessionId,
        runId: services.runId,
        messageId: services.messageId,
        type: input.type,
        body,
        fileName,
        payload: { sourcePath: input.path },
        ...(input.title ? { title: input.title } : {}),
        ...(input.contentType ? { contentType: input.contentType } : {}),
      });

      return JSON.stringify({
        artifactId: artifact.id,
        type: artifact.type,
        ...(artifact.title ? { title: artifact.title } : {}),
        downloadUrl: `/sessions/${services.sessionId}/artifacts/${artifact.id}/download`,
      });
    },
  };
}

function validateParams(params: Record<string, unknown>): {
  path: string;
  type: string;
  title?: string;
  contentType?: string;
  fileName?: string;
} {
  const filePath = readString(params.path, 'path', 2_048);
  if (filePath.includes('\0')) throw new Error('artifact_create path cannot contain NUL bytes');
  const type = readString(params.type, 'type', maxStringLength);
  if (!allowedTypes.has(type)) throw new Error(`artifact_create type must be one of ${[...allowedTypes].join(', ')}`);
  const result = { path: filePath, type };
  const title = readOptionalString(params.title, 'title', maxStringLength);
  const contentType = readOptionalString(params.contentType, 'contentType', 128);
  const fileName = readOptionalString(params.fileName, 'fileName', maxStringLength);
  if (title) Object.assign(result, { title });
  if (contentType) Object.assign(result, { contentType });
  if (fileName) Object.assign(result, { fileName });
  return result;
}

function readString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`artifact_create ${name} must be a non-empty string`);
  if (value.length > maxLength) throw new Error(`artifact_create ${name} cannot exceed ${maxLength} characters`);
  return value;
}

function readOptionalString(value: unknown, name: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return readString(value, name, maxLength);
}
