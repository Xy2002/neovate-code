/**
 * Type definitions for ACP (Agent Client Protocol) integration
 */

import type { ContentBlock, ToolCallContent } from '@agentclientprotocol/sdk';
import type { ApprovalCategory } from '../../tool';

/**
 * Options for creating ACP context
 */
export type ACPContextCreateOpts = {
  cwd?: string;
  productName: string;
  productASCIIArt?: string;
  version: string;
  argvConfig: Record<string, any>;
  plugins: any[];
  quiet?: boolean;
};

/**
 * Options for running ACP agent
 */
export type RunACPOpts = {
  cwd: string;
  contextCreateOpts?: ACPContextCreateOpts;
};

/**
 * Tool approval result from ACP client
 */
export type ACPToolApprovalResult = {
  approved: boolean;
  params?: Record<string, any>;
  denyReason?: string;
};
