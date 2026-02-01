import { ConfigManager, type McpServerConfig } from '../../config';
import type { Context } from '../../context';
import type { MessageBus } from '../../messageBus';

export function registerMcpHandlers(
  messageBus: MessageBus,
  getContext: (cwd: string) => Promise<Context>,
) {
  messageBus.registerHandler('mcp.getStatus', async (data) => {
    const { cwd } = data;
    const context = await getContext(cwd);
    const mcpManager = context.mcpManager;

    interface ServerData {
      status: string;
      error?: string;
      toolCount: number;
      tools: string[];
    }

    const configuredServers = context.config.mcpServers || {};
    const allServerStatus = await mcpManager.getAllServerStatus();
    const servers: Record<string, ServerData> = {};

    for (const serverName of mcpManager.getServerNames()) {
      const serverStatus = allServerStatus[serverName];
      let tools: string[] = [];

      if (serverStatus && serverStatus.status === 'connected') {
        try {
          const serverTools = await mcpManager.getTools([serverName]);
          tools = serverTools.map((tool) => tool.name);
        } catch (err) {
          console.warn(`Failed to fetch tools for server ${serverName}:`, err);
        }
      }

      servers[serverName] = {
        status: serverStatus?.status || 'disconnected',
        error: serverStatus?.error,
        toolCount: serverStatus?.toolCount || 0,
        tools,
      };
    }

    const configManager = new ConfigManager(cwd, context.productName, {});

    return {
      success: true,
      data: {
        servers,
        configs: configuredServers,
        globalConfigPath: configManager.globalConfigPath,
        projectConfigPath: configManager.projectConfigPath,
        isReady: mcpManager.isReady(),
        isLoading: mcpManager.isLoading(),
      },
    };
  });

  messageBus.registerHandler('mcp.reconnect', async (data) => {
    const { cwd, serverName } = data;
    try {
      const context = await getContext(cwd);
      const mcpManager = context.mcpManager;

      if (!mcpManager) {
        return {
          success: false,
          error: 'No MCP manager available',
        };
      }

      await mcpManager.retryConnection(serverName);

      return {
        success: true,
        message: `Successfully initiated reconnection for ${serverName}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  messageBus.registerHandler('mcp.list', async (data) => {
    const { cwd } = data;
    const context = await getContext(cwd);
    const configManager = new ConfigManager(cwd, context.productName, {});

    const projectConfig = configManager.projectConfig;
    const projectServers = projectConfig.mcpServers || {};
    const globalConfig = configManager.globalConfig;
    const globalServers = globalConfig.mcpServers || {};

    const mcpManager = context.mcpManager;
    const allServerStatus = await mcpManager.getAllServerStatus();

    const activeServers: Record<
      string,
      {
        status:
          | 'pending'
          | 'connecting'
          | 'connected'
          | 'failed'
          | 'disconnected';
        config: McpServerConfig;
        error?: string;
        toolCount?: number;
        tools: string[];
        scope: 'global' | 'project';
      }
    > = {};

    for (const [name, config] of Object.entries(globalServers)) {
      if (!config.disable) {
        activeServers[name] = {
          config,
          status: allServerStatus[name]?.status || 'disconnected',
          error: allServerStatus[name]?.error,
          toolCount: allServerStatus[name]?.toolCount || 0,
          tools: [],
          scope: 'global',
        };
      }
    }

    for (const [name, config] of Object.entries(projectServers)) {
      if (!config.disable) {
        activeServers[name] = {
          config,
          status: allServerStatus[name]?.status || 'disconnected',
          error: allServerStatus[name]?.error,
          toolCount: allServerStatus[name]?.toolCount || 0,
          tools: [],
          scope: 'project',
        };
      }
    }

    for (const [name, server] of Object.entries(activeServers)) {
      if (server.status === 'connected') {
        try {
          const serverTools = await mcpManager.getTools([name]);
          server.tools = serverTools.map((tool) => tool.name);
        } catch (err) {
          console.warn(`Failed to fetch tools for server ${name}:`, err);
        }
      }
    }

    return {
      success: true,
      data: {
        projectServers,
        globalServers,
        activeServers,
        projectConfigPath: configManager.projectConfigPath,
        globalConfigPath: configManager.globalConfigPath,
        isReady: mcpManager.isReady(),
        isLoading: mcpManager.isLoading(),
      },
    };
  });
}
