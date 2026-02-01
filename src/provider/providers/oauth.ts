export const OAUTH_PROVIDERS = ['github-copilot', 'qwen'] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(id: string): id is OAuthProviderId {
  return OAUTH_PROVIDERS.includes(id as OAuthProviderId);
}
