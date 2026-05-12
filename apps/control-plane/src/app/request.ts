import type { Context } from 'hono';
import { extractRepositoryReference, type RepositoryReference } from '../repositories/extract.js';

export async function readJsonBody(c: Context, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await readRawBody(c, maxBytes, 'JSON body');

  const trimmed = text.trim();
  if (!trimmed) return {};

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new HttpRequestError(400, 'invalid_json', 'Expected valid JSON request body');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpRequestError(400, 'invalid_request', 'Expected JSON object request body');
  }

  return value as Record<string, unknown>;
}

export async function readRawBody(c: Context, maxBytes: number, label: string): Promise<string> {
  const text = await c.req.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new HttpRequestError(413, 'payload_too_large', `${label} exceeds ${maxBytes} bytes`);
  }
  return text;
}

export class HttpRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function parseRepositoryBody(value: unknown): RepositoryReference | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  if (typeof value === 'string') {
    const reference = extractRepositoryReference(value);
    if (!reference)
      throw new HttpRequestError(400, 'invalid_request', 'Expected repository as owner/repo or GitHub URL');
    return reference;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpRequestError(400, 'invalid_request', 'Expected repository as owner/repo, GitHub URL, or object');
  }

  const repository = value as Record<string, unknown>;
  if (repository.provider !== 'github')
    throw new HttpRequestError(400, 'invalid_request', 'Expected repository.provider to be github');
  const owner = optionalString(repository.owner);
  const repo = optionalString(repository.repo);
  if (!owner || !repo)
    throw new HttpRequestError(400, 'invalid_request', 'Expected repository.owner and repository.repo');

  const reference = extractRepositoryReference(`repo:${owner}/${repo}`);
  if (!reference) throw new HttpRequestError(400, 'invalid_request', 'Expected valid GitHub repository owner and name');
  return reference;
}

export function parseCursor(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}
