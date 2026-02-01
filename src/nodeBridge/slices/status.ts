import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';
import { PluginHookType } from '../../plugin';

export function registerStatusHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
) {
  messageBus.registerHandler('status.get', async (data) => {
    const { cwd, sessionId } = data;
    const context = await getContext(cwd);
    const memo = {
      [`${context.productName}`]: {
        description: `v${context.version}`,
        items: [context.paths.getSessionLogPath(sessionId)],
      },
      'Working Directory': {
        items: [cwd],
      },
      Model: {
        items: [context.config.model],
      },
    };
    const status = await context.apply({
      hook: 'status',
      args: [],
      memo,
      type: PluginHookType.SeriesMerge,
    });
    return {
      success: true,
      data: {
        status,
      },
    };
  });
}
