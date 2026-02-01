import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';
import { type Provider, resolveModelWithContext } from '../../provider/model';

export function registerProvidersHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
) {
  messageBus.registerHandler('providers.list', async (data) => {
    const { cwd } = data;
    const context = await getContext(cwd);
    const { providers } = await resolveModelWithContext(null, context);
    return {
      success: true,
      data: {
        providers: normalizeProviders(providers, context),
      },
    };
  });
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '****';
  }
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
}

export function normalizeProviders(
  providers: Record<string, Provider>,
  context: Context,
) {
  return Object.values(providers).map((provider) => {
    const validEnvs: string[] = [];
    if (provider.env && Array.isArray(provider.env)) {
      provider.env.forEach((envVar: string) => {
        if (process.env[envVar]) {
          validEnvs.push(envVar);
        }
      });
    }
    if (provider.apiEnv && Array.isArray(provider.apiEnv)) {
      provider.apiEnv.forEach((envVar: string) => {
        if (process.env[envVar]) {
          validEnvs.push(envVar);
        }
      });
    }

    const configApiKey =
      context.config.provider?.[provider.id]?.options?.apiKey;
    const envApiKey = (() => {
      for (const envVar of provider.env || []) {
        if (process.env[envVar]) {
          return { key: process.env[envVar]!, envName: envVar };
        }
      }
      return null;
    })();

    const hasApiKey = !!(provider.options?.apiKey || configApiKey);

    let maskedApiKey: string | undefined;
    let apiKeyOrigin: 'env' | 'config' | undefined;
    let apiKeyEnvName: string | undefined;
    let oauthUser: string | undefined;

    if (envApiKey) {
      maskedApiKey = maskApiKey(envApiKey.key);
      apiKeyOrigin = 'env';
      apiKeyEnvName = envApiKey.envName;
    } else if (configApiKey) {
      apiKeyOrigin = 'config';
      if (provider.id === 'github-copilot' || provider.id === 'antigravity') {
        try {
          const account = JSON.parse(configApiKey);
          oauthUser =
            account.user?.login ||
            account.username ||
            account.email ||
            account.user?.email;
          maskedApiKey = oauthUser ? undefined : '(OAuth token)';
        } catch {
          maskedApiKey = '(OAuth token)';
        }
      } else {
        maskedApiKey = maskApiKey(configApiKey);
      }
    }

    return {
      id: provider.id,
      name: provider.name,
      doc: provider.doc,
      env: provider.env,
      apiEnv: provider.apiEnv,
      api: provider.api,
      options: provider.options,
      source: provider.source,
      apiFormat: provider.apiFormat,
      validEnvs,
      hasApiKey,
      maskedApiKey,
      apiKeyOrigin,
      apiKeyEnvName,
      oauthUser,
    };
  });
}
