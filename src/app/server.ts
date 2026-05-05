import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AppConfig } from '../config/index.js';
import { EventService } from '../events/service.js';
import { MessageService, MessageServiceError } from '../messages/service.js';
import { SessionService } from '../sessions/service.js';
import { MemoryStore } from '../store/memory.js';
import type { AppStore } from '../store/types.js';

export type AppServices = {
  store: AppStore;
  events: EventService;
  sessions: SessionService;
  messages: MessageService;
};

export function createServices(store: AppStore = new MemoryStore()): AppServices {
  const events = new EventService(store);
  return {
    store,
    events,
    sessions: new SessionService(store, events),
    messages: new MessageService(store, events),
  };
}

export function createServer(config: AppConfig, services = createServices()) {
  return createHttpServer((request, response) => {
    handleRequest(request, response, config, services).catch((error: unknown) => {
      writeError(response, 500, 'internal_error', error instanceof Error ? error.message : 'Unknown error');
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: AppConfig,
  services: AppServices,
) {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (request.method === 'GET' && request.url === '/health') {
    writeJson(response, 200, {
      status: 'ok',
      runMode: config.runMode,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/sessions') {
    const body = await readJsonBody(request);
    const title = optionalString(body.title);
    const session = await services.sessions.create(title ? { title } : {});
    writeJson(response, 201, { session });
    return;
  }

  const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
  if (request.method === 'GET' && sessionMatch) {
    const session = await services.sessions.get(decodeURIComponent(sessionMatch[1]!));
    if (!session) {
      writeError(response, 404, 'not_found', 'Session not found');
      return;
    }

    writeJson(response, 200, { session });
    return;
  }

  const messagesMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages$/);
  if (request.method === 'POST' && messagesMatch) {
    const sessionId = decodeURIComponent(messagesMatch[1]!);
    const body = await readJsonBody(request);
    const prompt = optionalString(body.prompt);
    if (!prompt) {
      writeError(response, 400, 'invalid_request', 'Expected non-empty string field: prompt');
      return;
    }

    try {
      const message = await services.messages.enqueue({ sessionId, prompt });
      writeJson(response, 202, { message });
    } catch (error) {
      if (error instanceof MessageServiceError && error.code === 'not_found') {
        writeError(response, 404, 'not_found', 'Session not found');
        return;
      }
      throw error;
    }
    return;
  }

  const eventsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/events$/);
  if (request.method === 'GET' && eventsMatch) {
    const sessionId = decodeURIComponent(eventsMatch[1]!);
    const session = await services.sessions.get(sessionId);
    if (!session) {
      writeError(response, 404, 'not_found', 'Session not found');
      return;
    }

    const after = parseCursor(url.searchParams.get('after'));
    const events = await services.events.list(sessionId, after);
    writeJson(response, 200, { events });
    return;
  }

  writeJson(response, 404, {
    error: 'not_found',
    message: 'Route not found',
  });
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, statusCode: number, error: string, message: string) {
  writeJson(response, statusCode, { error, message });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};

  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON object request body');
  }

  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseCursor(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}
