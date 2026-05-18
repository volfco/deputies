import type { AppConfig } from '../config/index.js';

export type ModelUnavailableDetails = {
  code: string;
  reason: string;
  action?: string;
};

export type ModelOption = {
  value: string;
  label: string;
  available: boolean;
  unavailableCode?: string;
  unavailableReason?: string;
  action?: string;
};

export type AppNotice = {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  action?: string;
};

export class ModelAvailabilityService {
  private readonly unavailablePrefixes = new Map<string, ModelUnavailableDetails>();

  setPrefixUnavailable(prefix: string, details: ModelUnavailableDetails): void {
    this.unavailablePrefixes.set(prefix, details);
  }

  clearPrefix(prefix: string): void {
    this.unavailablePrefixes.delete(prefix);
  }

  unavailableFor(model: string | undefined): ModelUnavailableDetails | undefined {
    if (!model) return undefined;
    for (const [prefix, details] of this.unavailablePrefixes) {
      if (model.startsWith(prefix)) return details;
    }
    return undefined;
  }

  notices(): AppNotice[] {
    return Array.from(this.unavailablePrefixes.entries()).map(([prefix, details]) => ({
      severity: 'warning',
      code: details.code,
      message: `${modelProviderLabel(prefix)} models are unavailable. ${details.reason}`,
      ...(details.action ? { action: details.action } : {}),
    }));
  }
}

export function configuredModels(config: Pick<AppConfig, 'flueModel' | 'flueModelOptions'>): string[] {
  return config.flueModelOptions.length ? config.flueModelOptions : config.flueModel ? [config.flueModel] : [];
}

export function modelOptions(
  config: Pick<AppConfig, 'flueModel' | 'flueModelOptions'>,
  availability: ModelAvailabilityService,
): ModelOption[] {
  return configuredModels(config).map((model) => {
    const unavailable = availability.unavailableFor(model);
    return {
      value: model,
      label: modelLabel(model),
      available: !unavailable,
      ...(unavailable
        ? {
            unavailableCode: unavailable.code,
            unavailableReason: unavailable.reason,
            ...(unavailable.action ? { action: unavailable.action } : {}),
          }
        : {}),
    };
  });
}

export function modelLabel(model: string): string {
  return model.replace(/^[^/]+\//, '').replace(/-/g, ' ');
}

function modelProviderLabel(prefix: string): string {
  if (prefix === 'openai-codex/') return 'OpenAI Codex';
  return prefix.replace(/\/$/, '');
}
