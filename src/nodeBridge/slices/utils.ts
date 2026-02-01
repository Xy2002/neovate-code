import z from 'zod';
import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';
import { resolveModelWithContext } from '../../provider/model';
import { query } from '../../query';
import { listDirectory } from '../../utils/list';

export function registerUtilsHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
) {
  messageBus.registerHandler('utils.query', async (data) => {
    const { userPrompt, cwd, systemPrompt } = data;
    const context = await getContext(cwd);
    const { model } = await resolveModelWithContext(
      data.model || context.config.model || null,
      context,
    );
    const result = await query({
      userPrompt,
      context,
      systemPrompt,
      model: model!,
      thinking: data.thinking,
      responseFormat: data.responseFormat,
    });
    return result;
  });

  messageBus.registerHandler('utils.quickQuery', async (data) => {
    const { cwd } = data;
    const context = await getContext(cwd);
    return await messageBus.messageHandlers.get('utils.query')?.({
      userPrompt: data.userPrompt,
      cwd,
      systemPrompt: data.systemPrompt,
      model: data.model || context.config.smallModel || null,
      thinking: data.thinking,
      responseFormat: data.responseFormat,
    });
  });

  messageBus.registerHandler('utils.summarizeMessage', async (data) => {
    const { message, cwd, model } = data;
    return await messageBus.messageHandlers.get('utils.quickQuery')?.({
      model,
      userPrompt: message,
      cwd,
      systemPrompt:
        "Extract a concise 2-5 word title that captures the main topic or intent of this message. Format your response as a JSON object with one field: 'title' (string).",
      responseFormat: {
        type: 'json',
        schema: z.toJSONSchema(
          z.object({
            title: z.string(),
          }),
        ),
      },
    });
  });

  messageBus.registerHandler('utils.getPaths', async (data) => {
    const { cwd, maxFiles = 6000 } = data;
    const context = await getContext(cwd);
    const result = listDirectory(context.cwd, context.cwd, maxFiles);
    return {
      success: true,
      data: {
        paths: result,
      },
    };
  });

  messageBus.registerHandler('utils.searchPaths', async (data) => {
    const { cwd, query, maxResults = 100 } = data;
    const context = await getContext(cwd);

    if (!query) {
      const { listRootDirectory } = await import('../../utils/list');
      const rootPaths = listRootDirectory(context.cwd);
      return {
        success: true,
        data: {
          paths: rootPaths,
          truncated: false,
        },
      };
    }

    const { searchFiles } = await import('../../utils/ripgrep');
    const result = await searchFiles(context.cwd, query, maxResults);
    return result;
  });

  messageBus.registerHandler('utils.telemetry', async (data) => {
    const { cwd, name, payload } = data;
    const context = await getContext(cwd);
    const { PluginHookType } = await import('../../plugin');
    await context.apply({
      hook: 'telemetry',
      args: [
        {
          name,
          payload,
        },
      ],
      type: PluginHookType.Parallel,
    });
    return {
      success: true,
    };
  });

  messageBus.registerHandler('utils.files.list', async (data) => {
    const { cwd, query } = data;
    const { getFiles } = await import('../../utils/files');
    return {
      success: true,
      data: {
        files: await getFiles({
          cwd,
          maxSize: 50,
          query: query || '',
        }),
      },
    };
  });

  messageBus.registerHandler('utils.tool.executeBash', async (data) => {
    const { cwd, command } = data;
    const { createBashTool } = await import('../../tools/bash');
    const context = await getContext(cwd);
    const bashTool = createBashTool({
      cwd,
      backgroundTaskManager: context.backgroundTaskManager,
    });

    try {
      const result = await bashTool.execute({ command });
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  messageBus.registerHandler('utils.open', async (data) => {
    const { cwd, app } = data;
    const { spawn } = await import('child_process');

    const commands: Record<string, { cmd: string; args: string[] }> = {
      cursor: { cmd: 'cursor', args: [cwd] },
      vscode: { cmd: 'code', args: [cwd] },
      'vscode-insiders': { cmd: 'code-insiders', args: [cwd] },
      zed: { cmd: 'zed', args: [cwd] },
      windsurf: { cmd: 'windsurf', args: [cwd] },
      antigravity: { cmd: 'agy', args: [cwd] },
      iterm: { cmd: 'open', args: ['-a', 'iTerm', cwd] },
      warp: { cmd: 'open', args: ['-a', 'Warp', cwd] },
      terminal: { cmd: 'open', args: ['-a', 'Terminal', cwd] },
      finder: { cmd: 'open', args: [cwd] },
      sourcetree: { cmd: 'open', args: ['-a', 'SourceTree', cwd] },
      fork: { cmd: 'open', args: ['-a', 'Fork', cwd] },
    };

    const config = commands[app];
    const child = spawn(config.cmd, config.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return { success: true };
  });

  messageBus.registerHandler('utils.playSound', async (data) => {
    const { sound, volume = 1.0 } = data;
    try {
      const { playSound, SOUND_PRESETS } = await import('../../utils/sound');

      const soundName =
        sound in SOUND_PRESETS
          ? SOUND_PRESETS[sound as keyof typeof SOUND_PRESETS]
          : sound;

      await playSound(soundName, volume);

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to play sound',
      };
    }
  });

  messageBus.registerHandler('utils.detectApps', async (data) => {
    const { apps: appsToCheck } = data;
    const { existsSync } = await import('fs');
    const { execSync } = await import('child_process');

    const allApps = [
      'finder',
      'cursor',
      'antigravity',
      'vscode',
      'vscode-insiders',
      'zed',
      'windsurf',
      'iterm',
      'warp',
      'terminal',
      'sourcetree',
      'fork',
    ] as const;

    const cliCommands: Record<string, string> = {
      cursor: 'cursor',
      vscode: 'code',
      'vscode-insiders': 'code-insiders',
      zed: 'zed',
      windsurf: 'windsurf',
      antigravity: 'agy',
    };

    const macApps: Record<string, string> = {
      iterm: '/Applications/iTerm.app',
      warp: '/Applications/Warp.app',
      terminal: '/System/Applications/Utilities/Terminal.app',
      sourcetree: '/Applications/Sourcetree.app',
      fork: '/Applications/Fork.app',
    };

    const checkApp = (app: string): boolean => {
      const isMacOS = process.platform === 'darwin';
      if (app === 'finder') {
        return isMacOS;
      }
      if (cliCommands[app]) {
        try {
          execSync(`which ${cliCommands[app]}`, { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      }
      if (macApps[app]) {
        return existsSync(macApps[app]);
      }
      return false;
    };

    const targetApps = appsToCheck || [...allApps];
    const installedApps = targetApps.filter(checkApp);

    return { success: true, data: { apps: installedApps } };
  });
}
