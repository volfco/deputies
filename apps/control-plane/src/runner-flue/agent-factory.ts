import {
  createFlueContext,
  InMemorySessionStore,
  resolveModel,
} from "@flue/sdk/internal";
import type {
  AgentInit,
  FlueHarness,
  FlueSession,
  SessionData,
  SessionStore,
  ShellOptions,
} from "@flue/sdk";
import { configureProvider } from '@flue/sdk/app';
import type { FlueAgentFactory, FlueAgentPort, FlueSessionPort } from "./types.js";
import { sandboxHandleToFlueFactory } from "./sandbox-factory.js";

export type RealFlueAgentFactoryOptions = {
  model: AgentInit["model"];
  providers?: Record<string, { apiKey?: string; baseUrl?: string; headers?: Record<string, string> }>;
  sessionStore?: SessionStore;
  env?: Record<string, unknown>;
};

export class RealFlueAgentFactory implements FlueAgentFactory {
  private readonly sessionStore: SessionStore;
  private readonly env: Record<string, unknown>;

  constructor(private readonly options: RealFlueAgentFactoryOptions) {
    this.sessionStore = options.sessionStore ?? new InMemorySessionStore();
    this.env = options.env ?? process.env;
    for (const [provider, settings] of Object.entries(options.providers ?? {})) {
      configureProvider(provider, settings);
    }
  }

  async create(
    input: Parameters<FlueAgentFactory["create"]>[0],
  ): Promise<FlueAgentPort> {
    const ctx = createFlueContext({
      id: input.agentId,
      runId: input.sessionId,
      payload: {},
      env: this.env,
      agentConfig: {
        systemPrompt: "",
        skills: {},
        roles: {},
        model: undefined,
        resolveModel,
      },
      createDefaultEnv: unsupportedEnv("default"),
      createLocalEnv: unsupportedEnv("local"),
      defaultStore: this.sessionStore,
    });
    ctx.setEventCallback(input.onEvent);

    const initOptions: AgentInit = {
      name: input.agentId,
      sandbox: sandboxHandleToFlueFactory(input.sandbox),
      model: this.options.model,
      persist: this.sessionStore,
    };
    if (input.cwd) initOptions.cwd = input.cwd;
    if (input.tools) initOptions.tools = input.tools;

    return adaptHarness(await ctx.init(initOptions), input.agentId, this.sessionStore);
  }

  async loadSession(id: string): Promise<SessionData | null> {
    return this.sessionStore.load(flueSessionStorageKey(id));
  }

  async saveSession(id: string, data: SessionData): Promise<void> {
    await this.sessionStore.save(flueSessionStorageKey(id), data);
  }

  async deleteSession(id: string): Promise<void> {
    await this.sessionStore.delete(flueSessionStorageKey(id));
  }
}

function flueSessionStorageKey(agentId: string, sessionId = agentId): string {
  return `agent-session:${JSON.stringify([agentId, sessionId])}`;
}

function unsupportedEnv(kind: string) {
  return async () => {
    throw new Error(
      `Flue ${kind} sandbox is not available in the background worker`,
    );
  };
}

function adaptHarness(harness: FlueHarness, agentId: string, sessionStore: SessionStore): FlueAgentPort {
  return {
    session: async (id?: string) => {
      const session = await harness.session(id);
      const sessionId = id ?? "default";
      const key = flueSessionStorageKey(agentId, sessionId);
      if (!(await sessionStore.load(key))) {
        const now = new Date().toISOString();
        await sessionStore.save(key, { version: 3, entries: [], leafId: null, metadata: {}, createdAt: now, updatedAt: now });
      }
      return adaptSession(session);
    },
    shell: (command, options) =>
      harness.shell(command, toFlueShellOptions(options)),
  };
}

function adaptSession(session: FlueSession): FlueSessionPort {
  return {
    prompt: (text) => session.prompt(text),
    shell: (command, options) =>
      session.shell(command, toFlueShellOptions(options)),
  };
}

function toFlueShellOptions(
  options: Parameters<NonNullable<FlueSessionPort["shell"]>>[1],
): ShellOptions | undefined {
  if (!options) return undefined;
  const signal =
    options.timeout === undefined
      ? options.signal
      : AbortSignal.any([
          ...(options.signal ? [options.signal] : []),
          AbortSignal.timeout(options.timeout),
        ]);
  const flueOptions: ShellOptions = {};
  if (options.cwd !== undefined) flueOptions.cwd = options.cwd;
  if (options.env !== undefined) flueOptions.env = options.env;
  if (signal !== undefined) flueOptions.signal = signal;
  return flueOptions;
}
