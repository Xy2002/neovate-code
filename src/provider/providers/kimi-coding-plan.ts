import { type Provider } from './types';

export const kimiCodingPlanProvider: Provider = {
  id: 'kimi-coding-plan',
  source: 'built-in',
  env: ['KIMI_CODING_API_KEY'],
  name: 'Kimi Coding Plan',
  api: 'https://api.kimi.com/coding/v1',
  doc: 'https://www.kimi.com/code/docs/more/third-party-agents.html',
  models: {
    'kimi-for-coding': 'kimi-k2.5',
  },
  headers: {
    'user-agent': 'KimiCLI/1.8.0',
  },
};
