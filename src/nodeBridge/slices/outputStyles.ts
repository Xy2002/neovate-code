import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';
import { OutputStyleManager } from '../../outputStyle';

export function registerOutputStylesHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
) {
  messageBus.registerHandler('outputStyles.list', async (data) => {
    const { cwd } = data;
    const context = await getContext(cwd);
    const outputStyleManager = await OutputStyleManager.create(context);
    return {
      success: true,
      data: {
        outputStyles: outputStyleManager.outputStyles.map((style) => ({
          name: style.name,
          description: style.description,
        })),
        currentOutputStyle: context.config.outputStyle,
      },
    };
  });
}
