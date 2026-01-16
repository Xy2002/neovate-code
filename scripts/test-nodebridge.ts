#!/usr/bin/env bun

/**
 * Test script for NodeBridge handlers
 *
 * Usage:
 *   bun scripts/test-nodebridge.ts [handler] [options]
 *
 * Examples:
 *   bun scripts/test-nodebridge.ts models.test --model anthropic/claude-sonnet-4-20250514
 *   bun scripts/test-nodebridge.ts models.list
 *   bun scripts/test-nodebridge.ts --list
 */

import { DirectTransport, MessageBus } from '../src/messageBus';
import { NodeBridge } from '../src/nodeBridge';

interface ParsedArgs {
  help: boolean;
  list: boolean;
  handler: string | null;
  model: string | null;
  cwd: string;
}

function parseArgs(): ParsedArgs {
  const args = Bun.argv.slice(2);
  const result: ParsedArgs = {
    help: false,
    list: false,
    handler: null,
    model: null,
    cwd: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '-l' || arg === '--list') {
      result.list = true;
    } else if (arg === '--model' && args[i + 1]) {
      result.model = args[++i];
    } else if (arg === '--cwd' && args[i + 1]) {
      result.cwd = args[++i];
    } else if (!arg.startsWith('-') && !result.handler) {
      result.handler = arg;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Usage: bun scripts/test-nodebridge.ts [handler] [options]

Test NodeBridge message handlers.

Arguments:
  handler           Handler name to test (e.g., models.test, models.list)

Options:
  -h, --help        Show this help message
  -l, --list        List all available handlers
  --model <model>   Model string for models.test (e.g., anthropic/claude-sonnet-4-20250514)
  --cwd <path>      Working directory (defaults to current directory)

Examples:
  bun scripts/test-nodebridge.ts --list
  bun scripts/test-nodebridge.ts models.list
  bun scripts/test-nodebridge.ts models.test --model anthropic/claude-sonnet-4-20250514
  bun scripts/test-nodebridge.ts providers.list
  bun scripts/test-nodebridge.ts config.list
`);
}

// Available handlers for testing
const HANDLERS: Record<
  string,
  { description: string; getData: (args: ParsedArgs) => any }
> = {
  // Models
  'models.list': {
    description: 'List all available models grouped by provider',
    getData: (args) => ({ cwd: args.cwd }),
  },
  'models.test': {
    description: 'Test a specific model with a simple request',
    getData: (args) => ({
      cwd: args.cwd,
      model: args.model || 'anthropic/claude-sonnet-4-20250514',
    }),
  },

  // Config
  'config.list': {
    description: 'List all configuration',
    getData: (args) => ({ cwd: args.cwd }),
  },

  // Providers
  'providers.list': {
    description: 'List all available providers',
    getData: (args) => ({ cwd: args.cwd }),
  },

  // MCP
  'mcp.list': {
    description: 'List MCP servers',
    getData: (args) => ({ cwd: args.cwd }),
  },
  'mcp.getStatus': {
    description: 'Get MCP status',
    getData: (args) => ({ cwd: args.cwd }),
  },

  // Output Styles
  'outputStyles.list': {
    description: 'List available output styles',
    getData: (args) => ({ cwd: args.cwd }),
  },

  // Project
  'project.getRepoInfo': {
    description: 'Get repository information',
    getData: (args) => ({ cwd: args.cwd }),
  },
  'project.workspaces.list': {
    description: 'List all workspaces',
    getData: (args) => ({ cwd: args.cwd }),
  },

  // Sessions
  'sessions.list': {
    description: 'List all sessions',
    getData: (args) => ({ cwd: args.cwd }),
  },

  // Slash Commands
  'slashCommand.list': {
    description: 'List all slash commands',
    getData: (args) => ({ cwd: args.cwd }),
  },

  // Git
  'git.status': {
    description: 'Get git status',
    getData: (args) => ({ cwd: args.cwd }),
  },
  'git.detectGitHub': {
    description: 'Detect GitHub CLI and remote',
    getData: (args) => ({ cwd: args.cwd }),
  },

  // Utils
  'utils.getPaths': {
    description: 'Get file paths in project',
    getData: (args) => ({ cwd: args.cwd, maxFiles: 100 }),
  },
  'utils.detectApps': {
    description: 'Detect installed applications',
    getData: (args) => ({ cwd: args.cwd }),
  },
};

function listHandlers(): void {
  console.log('\nAvailable handlers:\n');
  const grouped: Record<string, string[]> = {};

  for (const [name, config] of Object.entries(HANDLERS)) {
    const [group] = name.split('.');
    if (!grouped[group]) {
      grouped[group] = [];
    }
    grouped[group].push(`  ${name.padEnd(30)} ${config.description}`);
  }

  for (const [group, handlers] of Object.entries(grouped)) {
    console.log(`\x1b[36m${group}\x1b[0m`);
    for (const handler of handlers) {
      console.log(handler);
    }
    console.log();
  }
}

async function createNodeBridge(): Promise<MessageBus> {
  const nodeBridge = new NodeBridge({
    contextCreateOpts: {
      productName: 'neovate',
      version: '0.0.0-test',
      argvConfig: {},
      plugins: [],
    },
  });

  const [uiTransport, nodeTransport] = DirectTransport.createPair();
  const uiMessageBus = new MessageBus();
  uiMessageBus.setTransport(uiTransport);
  nodeBridge.messageBus.setTransport(nodeTransport);

  return uiMessageBus;
}

async function testHandler(
  messageBus: MessageBus,
  handler: string,
  data: any,
): Promise<void> {
  console.log(`\n\x1b[36m━━━ Testing: ${handler} ━━━\x1b[0m\n`);
  console.log('\x1b[33mRequest:\x1b[0m');
  console.log(JSON.stringify(data, null, 2));

  const startTime = Date.now();

  try {
    const response = await Promise.race([
      messageBus.request(handler, data),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout (30s)')), 30000),
      ),
    ]);

    const duration = Date.now() - startTime;

    console.log(`\n\x1b[32mResponse:\x1b[0m (${duration}ms)`);
    console.log(JSON.stringify(response, null, 2));
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.log(`\n\x1b[31mError:\x1b[0m (${duration}ms)`);
    console.log(error.message);
    if (error.stack) {
      console.log('\x1b[90m' + error.stack + '\x1b[0m');
    }
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.list) {
    listHandlers();
    process.exit(0);
  }

  if (!args.handler) {
    console.error(
      'Error: No handler specified. Use --list to see available handlers.\n',
    );
    showHelp();
    process.exit(1);
  }

  const handlerConfig = HANDLERS[args.handler];
  if (!handlerConfig) {
    console.error(`Error: Unknown handler "${args.handler}"`);
    console.error('Use --list to see available handlers.');
    process.exit(1);
  }

  console.log('\x1b[90mInitializing NodeBridge...\x1b[0m');
  const messageBus = await createNodeBridge();

  const data = handlerConfig.getData(args);
  await testHandler(messageBus, args.handler, data);

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
