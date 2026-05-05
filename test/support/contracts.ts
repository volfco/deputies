const eventTypes = new Set([
  'session_created',
  'message_created',
  'message_started',
  'run_started',
  'sandbox_starting',
  'sandbox_ready',
  'agent_text_delta',
  'tool_started',
  'tool_finished',
  'artifact_created',
  'run_completed',
  'run_failed',
  'message_completed',
  'message_failed',
  'callback_sent',
  'callback_failed',
]);

export function expectSessionResponse(value: unknown): asserts value is { session: { id: string; status: string; title?: string } } {
  expect(isRecord(value)).toBe(true);
  const session = isRecord(value) ? value.session : undefined;
  expect(isRecord(session)).toBe(true);
  if (!isRecord(session)) return;
  expect(typeof session.id).toBe('string');
  expect(typeof session.status).toBe('string');
  expect(typeof session.createdAt).toBe('string');
  expect(typeof session.updatedAt).toBe('string');
  if (session.title !== undefined) expect(typeof session.title).toBe('string');
}

export function expectMessageResponse(value: unknown): asserts value is { message: { id: string; sessionId: string; sequence: number; status: string; prompt: string } } {
  expect(isRecord(value)).toBe(true);
  const message = isRecord(value) ? value.message : undefined;
  expect(isRecord(message)).toBe(true);
  if (!isRecord(message)) return;
  expect(typeof message.id).toBe('string');
  expect(typeof message.sessionId).toBe('string');
  expect(typeof message.sequence).toBe('number');
  expect(typeof message.status).toBe('string');
  expect(typeof message.prompt).toBe('string');
  expect(typeof message.createdAt).toBe('string');
}

export function expectEventsResponse(value: unknown): asserts value is { events: Array<{ type: string; sequence: number }> } {
  expect(isRecord(value)).toBe(true);
  const events = isRecord(value) ? value.events : undefined;
  expect(Array.isArray(events)).toBe(true);
  if (!Array.isArray(events)) return;
  for (const event of events) expectNormalizedEvent(event);
}

export function expectGenericWebhookResponse(
  value: unknown,
): asserts value is { accepted: boolean; duplicate: boolean; session?: { id: string }; message?: { id: string; prompt: string } } {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) return;
  expect(typeof value.accepted).toBe('boolean');
  expect(typeof value.duplicate).toBe('boolean');
  if (value.session !== undefined) {
    expect(isRecord(value.session)).toBe(true);
    if (isRecord(value.session)) expect(typeof value.session.id).toBe('string');
  }
  if (value.message !== undefined) {
    expect(isRecord(value.message)).toBe(true);
    if (isRecord(value.message)) {
      expect(typeof value.message.id).toBe('string');
      expect(typeof value.message.prompt).toBe('string');
    }
  }
}

export function expectErrorResponse(value: unknown): asserts value is { error: string; message: string } {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) return;
  expect(typeof value.error).toBe('string');
  expect(typeof value.message).toBe('string');
}

function expectNormalizedEvent(value: unknown): void {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) return;
  expect(typeof value.sessionId).toBe('string');
  expect(typeof value.sequence).toBe('number');
  expect(eventTypes.has(String(value.type))).toBe(true);
  expect(isRecord(value.payload)).toBe(true);
  expect(typeof value.createdAt).toBe('string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
