/**
 * ACP Command Entry Point
 * Run Neovate as an ACP (Agent Client Protocol) agent
 */

import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'stream';
import createDebug from 'debug';
import { PRODUCT_NAME } from '../../constants';
import type { ACPContextCreateOpts, RunACPOpts } from './types';
import { NeovateACPAgent } from './agent';

const debug = createDebug('neovate:acp');

/**
 * Log to stderr (safe for ACP, won't pollute stdout)
 */
function log(message: string, ...args: any[]) {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] [ACP] ${message}
`);
  if (args.length > 0) {
    process.stderr.write(`${JSON.stringify(args, null, 2)}
`);
  }
}

/**
 * Run Neovate as an ACP agent
 * Communicates via stdin/stdout using the ACP protocol
 */
export async function runACP(opts: RunACPOpts): Promise<void> {
  const cwd = opts.cwd || process.cwd();

  log('Starting Neovate ACP agent');
  log('Working directory:', cwd);

  // Get version from package.json
  const pkg = await import('../../../package.json');
  const version = pkg.version || '0.0.0';
  log('Version:', version);

  // Prepare context creation options
  const contextCreateOpts: ACPContextCreateOpts = {
    cwd,
    ...(opts.contextCreateOpts || {}),
    productName: opts.contextCreateOpts?.productName || PRODUCT_NAME,
    version: opts.contextCreateOpts?.version || version,
    argvConfig: opts.contextCreateOpts?.argvConfig || { quiet: true },
    plugins: opts.contextCreateOpts?.plugins || [],
    quiet: true,
  };

  // Ensure quiet mode to avoid stdout pollution
  contextCreateOpts.quiet = true;
  contextCreateOpts.argvConfig = contextCreateOpts.argvConfig || {};
  contextCreateOpts.argvConfig.quiet = true;

  debug('Context options: %O', contextCreateOpts);

  // Create stdio streams for ACP communication
  log('Setting up stdio streams for ACP communication');
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(
    process.stdin,
  ) as unknown as ReadableStream<Uint8Array>; // Type will be correct after SDK install

  // Create ACP connection
  log('Creating ACP connection');
  const stream = ndJsonStream(input, output);
  const connection = new AgentSideConnection((conn: any) => {
    log('ACP connection established, creating agent');
    const agent = new NeovateACPAgent(conn, contextCreateOpts);
    return agent;
  }, stream);

  log('ACP agent ready, waiting for messages...');

  // The connection will handle all communication automatically
  // Keep the process running
  process.on('SIGINT', () => {
    log('Received SIGINT, shutting down');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down');
    process.exit(0);
  });

  // Log unhandled errors
  process.on('uncaughtException', (error) => {
    log('Uncaught exception:', error.message);
    process.stderr.write(error.stack || '');
  });

  process.on('unhandledRejection', (reason) => {
    log('Unhandled rejection:', reason);
  });
}
