import { ConfigManager } from '../../config';
import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';

export function registerConfigHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
  clearContext: (cwd: string) => Promise<void>,
) {
  messageBus.registerHandler('config.get', async (data) => {
    const { cwd, key, isGlobal } = data;
    const context = await getContext(cwd);
    const configManager = new ConfigManager(
      cwd,
      context.productName,
      context.argvConfig,
    );
    const value = configManager.getConfig(isGlobal, key);
    return {
      success: true,
      data: {
        value,
      },
    };
  });

  messageBus.registerHandler('config.set', async (data) => {
    const { cwd, key, value, isGlobal } = data;
    const context = await getContext(cwd);
    const configManager = new ConfigManager(cwd, context.productName, {});
    configManager.setConfig(isGlobal, key, value);
    await clearContext(cwd);
    return {
      success: true,
    };
  });

  messageBus.registerHandler('config.remove', async (data) => {
    const { cwd, key, isGlobal, values } = data;
    const context = await getContext(cwd);
    const configManager = new ConfigManager(cwd, context.productName, {});
    configManager.removeConfig(isGlobal, key, values);
    await clearContext(cwd);
    return {
      success: true,
    };
  });

  messageBus.registerHandler('config.list', async (data) => {
    const { cwd } = data;
    const context = await getContext(cwd);
    return {
      success: true,
      data: {
        globalConfigDir: context.paths.globalConfigDir,
        projectConfigDir: context.paths.projectConfigDir,
        config: context.config,
      },
    };
  });
}
