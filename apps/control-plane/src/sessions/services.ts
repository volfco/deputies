export const maxServiceLabelLength = 80;
export const maxServicePathLength = 512;

export type PublishedService = {
  port: number;
  label?: string;
  path?: string;
  providerSandboxId?: string;
  runtimeId?: string;
};

export function readServices(context: Record<string, unknown>): PublishedService[] {
  const value = context.services;
  if (!Array.isArray(value)) return [];
  const services: PublishedService[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (!isValidServicePort(record.port)) continue;
    const service: PublishedService = { port: record.port };
    if (typeof record.label === 'string' && record.label.trim())
      service.label = record.label.slice(0, maxServiceLabelLength);
    if (typeof record.path === 'string' && isValidServicePath(record.path))
      service.path = record.path.slice(0, maxServicePathLength);
    if (typeof record.providerSandboxId === 'string' && record.providerSandboxId.trim()) {
      service.providerSandboxId = record.providerSandboxId;
    }
    if (typeof record.runtimeId === 'string' && record.runtimeId.trim()) service.runtimeId = record.runtimeId;
    services.push(service);
  }
  return services;
}

export function isValidServicePath(value: string): boolean {
  return value.startsWith('/') && !/\s/.test(value);
}

function isValidServicePort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}
