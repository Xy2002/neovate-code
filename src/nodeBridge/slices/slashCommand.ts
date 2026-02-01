import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';
import { SlashCommandManager } from '../../slashCommand';
import type { Message, UserMessage } from '../../message';

export function registerSlashCommandHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
) {
  messageBus.registerHandler('slashCommand.list', async (data) => {
    const { cwd } = data;
    const context = await getContext(cwd);
    const slashCommandManager = await SlashCommandManager.create(context);
    return {
      success: true,
      data: {
        slashCommands: slashCommandManager.getAll(),
      },
    };
  });

  messageBus.registerHandler('slashCommand.get', async (data) => {
    const { cwd, command } = data;
    const context = await getContext(cwd);
    const slashCommandManager = await SlashCommandManager.create(context);
    const commandEntry = slashCommandManager.get(command);
    return {
      success: true,
      data: {
        commandEntry,
      },
    };
  });

  messageBus.registerHandler('slashCommand.execute', async (data) => {
    const { cwd, command, args } = data;
    const context = await getContext(cwd);
    const slashCommandManager = await SlashCommandManager.create(context);
    const commandEntry = slashCommandManager.get(command);
    if (!commandEntry) {
      return {
        success: true,
        data: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: `Command ${command} not found` }],
            },
          ],
        },
      };
    }
    const type = commandEntry.command.type;
    if (type === 'local') {
      const result = await commandEntry.command.call(args, context as any);
      return {
        success: true,
        data: {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: result,
                },
              ],
            },
          ],
        },
      };
    } else if (type === 'prompt') {
      const messages = (await commandEntry.command.getPromptForCommand(
        args,
      )) as Message[];
      for (const message of messages) {
        if (message.role === 'user') {
          (message as UserMessage).hidden = true;
        }
        if (message.role === 'user' && typeof message.content === 'string') {
          message.content = [
            {
              type: 'text',
              text: message.content,
            },
          ];
        }
      }
      return {
        success: true,
        data: {
          messages,
        },
      };
    } else {
      return {
        success: true,
        data: {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Unknown slash command type: ${type}`,
                },
              ],
            },
          ],
        },
      };
    }
  });
}
