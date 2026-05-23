import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Writable, Readable } from 'node:stream';
import * as k8s from '@kubernetes/client-node';
import type {
  ConnectSandboxInput,
  CreateSandboxInput,
  FileStat,
  SandboxCapabilities,
  SandboxExecInput,
  SandboxExecResult,
  SandboxFileSystem,
  SandboxHandle,
  SandboxHealth,
  SandboxProvider,
  SandboxProviderCheck,
  SandboxRef,
} from './types.js';

const containerName = 'sandbox';
const defaultNamespace = 'default';
const defaultImage = 'ghcr.io/sidpalas/deputies-docker-sandbox:latest';
const defaultWorkspacePath = '/workspace';
const podReadyTimeoutMs = 60_000;
const podReadyPollMs = 500;

export const kubernetesCapabilities: SandboxCapabilities = {
  persistentFilesystem: false,
  snapshots: false,
  stopStart: false,
  exec: true,
  filesystem: true,
  streamingLogs: false,
  portForwarding: false,
  previewUrls: false,
  objectStorageArtifacts: false,
};

export type KubernetesSandboxProviderOptions = {
  namespace?: string;
  image?: string;
  workspacePath?: string;
  podCreationTimeoutMs?: number;
  execTimeoutMs?: number;
  podCpu?: string;
  podMemory?: string;
};

type K8sSandboxDescriptor = {
  providerSandboxId: string;
  sessionId: string;
  workspacePath: string;
  metadata: Record<string, unknown>;
};

export class KubernetesSandboxProvider implements SandboxProvider {
  readonly name = 'kubernetes';
  readonly capabilities = kubernetesCapabilities;
  private readonly kc: k8s.KubeConfig;
  private readonly namespace: string;
  private readonly image: string;
  private readonly workspacePath: string;
  private readonly podCreationTimeoutMs: number;
  private readonly execTimeoutMs: number;
  private readonly podCpu?: string;
  private readonly podMemory?: string;
  private readonly descriptors = new Map<string, K8sSandboxDescriptor>();

  constructor(options: KubernetesSandboxProviderOptions = {}) {
    this.kc = loadKubeConfig();
    this.namespace = options.namespace ?? defaultNamespace;
    this.image = options.image ?? defaultImage;
    this.workspacePath = options.workspacePath ?? defaultWorkspacePath;
    this.podCreationTimeoutMs = options.podCreationTimeoutMs ?? podReadyTimeoutMs;
    this.execTimeoutMs = options.execTimeoutMs ?? 60_000;
    if (options.podCpu !== undefined) this.podCpu = options.podCpu;
    if (options.podMemory !== undefined) this.podMemory = options.podMemory;
  }

  async check(): Promise<SandboxProviderCheck> {
    try {
      await this.apiRequest('GET', '/api/v1/namespaces/' + encodeURIComponent(this.namespace));
      return { status: 'ready', checkedAt: new Date() };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Kubernetes API connection failed',
        checkedAt: new Date(),
      };
    }
  }

  async create(input: CreateSandboxInput): Promise<SandboxHandle> {
    const podName = this.podName(input.sessionId);
    const pod = this.buildPodSpec(podName, input.sessionId);

    await this.apiRequest('POST', `/api/v1/namespaces/${encodeURIComponent(this.namespace)}/pods`, pod);

    try {
      await this.waitForPodReady(podName);
      const descriptor: K8sSandboxDescriptor = {
        providerSandboxId: podName,
        sessionId: input.sessionId,
        workspacePath: this.workspacePath,
        metadata: {
          ...input.metadata,
          podName,
          namespace: this.namespace,
          image: this.image,
          workspacePath: this.workspacePath,
        },
      };
      this.descriptors.set(podName, descriptor);
      return this.toHandle(descriptor);
    } catch (error) {
      await this.destroy({ providerSandboxId: podName, sessionId: input.sessionId }).catch(() => undefined);
      throw error;
    }
  }

  async connect(input: ConnectSandboxInput): Promise<SandboxHandle> {
    const existing = this.descriptors.get(input.providerSandboxId);
    if (existing) return this.toHandle(existing);

    await this.apiRequest(
      'GET',
      `/api/v1/namespaces/${encodeURIComponent(this.namespace)}/pods/${encodeURIComponent(input.providerSandboxId)}`,
    );

    const descriptor: K8sSandboxDescriptor = {
      providerSandboxId: input.providerSandboxId,
      sessionId: input.sessionId,
      workspacePath: this.workspacePath,
      metadata: input.metadata ?? {},
    };
    this.descriptors.set(input.providerSandboxId, descriptor);
    return this.toHandle(descriptor);
  }

  async destroy(input: SandboxRef): Promise<void> {
    this.descriptors.delete(input.providerSandboxId);
    try {
      await this.apiRequest(
        'DELETE',
        `/api/v1/namespaces/${encodeURIComponent(this.namespace)}/pods/${encodeURIComponent(input.providerSandboxId)}`,
        { apiVersion: 'v1', kind: 'DeleteOptions', gracePeriodSeconds: 0 },
      );
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
  }

  async health(input: SandboxRef): Promise<SandboxHealth> {
    try {
      const data = (await this.apiRequest(
        'GET',
        `/api/v1/namespaces/${encodeURIComponent(this.namespace)}/pods/${encodeURIComponent(input.providerSandboxId)}`,
      )) as Record<string, unknown>;
      const status = data?.status as Record<string, unknown> | undefined;
      const phase = (status?.phase as string | undefined) ?? 'Unknown';

      if (phase === 'Running') return { status: 'ready', checkedAt: new Date() };
      if (phase === 'Pending') return { status: 'starting', checkedAt: new Date() };
      if (phase === 'Succeeded' || phase === 'Failed') {
        return { status: 'stopped', message: `Pod phase: ${phase}`, checkedAt: new Date() };
      }
      return { status: 'unhealthy', message: `Pod phase: ${phase}`, checkedAt: new Date() };
    } catch (error) {
      if (isNotFoundError(error)) return { status: 'missing', checkedAt: new Date() };
      throw error;
    }
  }

  private async apiRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    const cluster = this.kc.getCurrentCluster();
    if (!cluster) throw new Error('No active Kubernetes cluster');

    const url = `${cluster.server}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    const user = this.kc.getCurrentUser();
    if (user?.token) {
      headers.authorization = `Bearer ${user.token}`;
    } else {
      const token = readInClusterToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    const init: RequestInit = { method, headers };
    if (body) init.body = JSON.stringify(body);

    const response = await fetch(url, init);
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const k8sError = data as Record<string, unknown> | undefined;
      const message =
        (k8sError?.message as string | undefined) ?? (k8sError?.error as string | undefined) ?? `HTTP ${response.status}`;
      const err = new Error(message);
      (err as unknown as Record<string, unknown>)['statusCode'] = response.status;
      throw err;
    }

    return data;
  }

  private buildPodSpec(podName: string, sessionId: string): Record<string, unknown> {
    const labels: Record<string, string> = {
      'deputies/sandbox-provider': 'kubernetes',
      'deputies/session-id': sessionId,
    };
    const env = [
      { name: 'DEPUTIES_WORKSPACE', value: this.workspacePath },
      { name: 'DEPUTIES_SANDBOX_TOKEN', value: randomUUID() },
    ];
    const resources: Record<string, unknown> = {};
    const requests: Record<string, string> = {};
    if (this.podCpu) requests.cpu = this.podCpu;
    if (this.podMemory) requests.memory = this.podMemory;
    if (Object.keys(requests).length) resources.requests = requests;
    const limits: Record<string, string> = {};
    if (this.podCpu) limits.cpu = this.podCpu;
    if (this.podMemory) limits.memory = this.podMemory;
    if (Object.keys(limits).length) resources.limits = limits;

    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
        labels,
      },
      spec: {
        restartPolicy: 'Never',
        containers: [
          {
            name: containerName,
            image: this.image,
            command: ['sleep', 'infinity'],
            workingDir: this.workspacePath,
            env,
            ...(Object.keys(resources).length ? { resources } : {}),
          },
        ],
      },
    };
  }

  private async waitForPodReady(podName: string): Promise<void> {
    const startedAt = Date.now();
    let lastPhase = '';
    while (Date.now() - startedAt < this.podCreationTimeoutMs) {
      try {
        const data = (await this.apiRequest(
          'GET',
          `/api/v1/namespaces/${encodeURIComponent(this.namespace)}/pods/${encodeURIComponent(podName)}`,
        )) as Record<string, unknown>;
        const status = data?.status as Record<string, unknown> | undefined;
        const phase = (status?.phase as string | undefined) ?? '';
        if (phase === 'Running') return;
        if (phase === 'Failed' || phase === 'Succeeded') {
          throw new Error(`Pod entered phase ${phase} before becoming ready`);
        }
        if (phase !== lastPhase) {
          lastPhase = phase;
        }
        await sleep(podReadyPollMs);
      } catch (error) {
        if (error instanceof Error && !('statusCode' in (error as object))) throw error;
        await sleep(podReadyPollMs);
      }
    }
    throw new Error(`Pod ${podName} did not become Ready within ${this.podCreationTimeoutMs}ms (last phase: ${lastPhase})`);
  }

  private podName(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9.-]/g, '-').slice(0, 50) || 'sandbox';
    return `deputies-${safe}-${randomUUID().slice(0, 8)}`;
  }

  private toHandle(descriptor: K8sSandboxDescriptor): SandboxHandle {
    const ref: SandboxRef = {
      providerSandboxId: descriptor.providerSandboxId,
      sessionId: descriptor.sessionId,
    };
    return {
      provider: this.name,
      providerSandboxId: descriptor.providerSandboxId,
      sessionId: descriptor.sessionId,
      workspacePath: descriptor.workspacePath,
      metadata: descriptor.metadata,
      capabilities: this.capabilities,
      fs: createKubernetesFileSystem(this.kc, this.namespace, descriptor.providerSandboxId),
      exec: (input) => execInPod(this.kc, this.namespace, descriptor.providerSandboxId, input, this.execTimeoutMs),
    };
  }
}

function createKubernetesFileSystem(
  kc: k8s.KubeConfig,
  namespace: string,
  podName: string,
): SandboxFileSystem {
  return {
    async readFile(path: string): Promise<string> {
      const result = await execInPod(kc, namespace, podName, { command: `cat ${escapePath(path)}` });
      return result.stdout;
    },
    async readFileBuffer(path: string): Promise<Uint8Array> {
      const result = await execInPod(kc, namespace, podName, {
        command: `base64 -w0 ${escapePath(path)}`,
      });
      return new Uint8Array(Buffer.from(result.stdout.trim(), 'base64'));
    },
    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
      const encoded = Buffer.from(content).toString('base64');
      await execInPod(kc, namespace, podName, {
        command: `base64 -d > ${escapePath(path)}`,
        stdin: encoded,
      });
    },
    async stat(path: string): Promise<FileStat> {
      const result = await execInPod(kc, namespace, podName, {
        command: `stat -c '%F %s %Y' ${escapePath(path)}`,
      });
      const parts = result.stdout.trim().split(' ');
      const type = parts[0] ?? '';
      return {
        isFile: type === 'regular file' || type === 'regular empty file',
        isDirectory: type === 'directory',
        isSymbolicLink: type === 'symbolic link',
        size: Number(parts[1] ?? 0),
        mtime: new Date(Number(parts[2] ?? 0) * 1000),
      };
    },
    async readdir(path: string): Promise<string[]> {
      const result = await execInPod(kc, namespace, podName, {
        command: `ls -1 ${escapePath(path)}`,
      });
      return result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
    },
    async exists(path: string): Promise<boolean> {
      const result = await execInPod(kc, namespace, podName, {
        command: `test -e ${escapePath(path)} && echo 'true' || echo 'false'`,
      });
      return result.stdout.trim() === 'true';
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const flag = options?.recursive ? '-p' : '';
      await execInPod(kc, namespace, podName, {
        command: `mkdir ${flag} ${escapePath(path)}`,
      });
    },
    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      let cmd = 'rm';
      if (options?.recursive) cmd += ' -r';
      if (options?.force) cmd += ' -f';
      cmd += ` ${escapePath(path)}`;
      await execInPod(kc, namespace, podName, { command: cmd });
    },
  };
}

async function execInPod(
  kc: k8s.KubeConfig,
  namespace: string,
  podName: string,
  input: SandboxExecInput & { stdin?: string },
  defaultTimeoutMs = 60_000,
): Promise<SandboxExecResult> {
  const startedAt = new Date();

  return new Promise((resolve, reject) => {
    const exec = new k8s.Exec(kc);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const settle = (exitCode: number) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        startedAt,
        completedAt: new Date(),
      });
    };

    const stdoutStream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });

    const stderrStream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });

    const stdinStream = input.stdin ? Readable.from([Buffer.from(input.stdin)]) : null;

    const wsPromise = exec.exec(
      namespace,
      podName,
      containerName,
      ['/bin/sh', '-c', input.command],
      stdoutStream,
      stderrStream,
      stdinStream,
      false,
      (status: k8s.V1Status) => {
        if (status.status === 'Success') settle(0);
        else settle(status.code && status.code > 0 ? status.code : 1);
      },
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        wsPromise.then((ws) => ws.close()).catch(() => undefined);
        resolve({
          exitCode: -1,
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8') || `Command timed out after ${timeoutMs}ms`,
          startedAt,
          completedAt: new Date(),
        });
      }
    }, timeoutMs);
    timer.unref();

    wsPromise.catch((error: Error) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        reject(error);
      }
    });
  });
}

function loadKubeConfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  try {
    kc.loadFromCluster();
    return kc;
  } catch {
    try {
      kc.loadFromDefault();
      return kc;
    } catch {
      return kc;
    }
  }
}

function readInClusterToken(): string | undefined {
  try {
    return readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf-8');
  } catch {
    return undefined;
  }
}

function escapePath(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const named = error as Error & { statusCode?: number };
  return named.statusCode === 404;
}
