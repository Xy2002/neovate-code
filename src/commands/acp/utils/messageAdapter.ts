/**
 * Message format adapter between ACP and Neovate
 */

import type {
  ContentBlock,
  Diff,
  ToolCallContent,
  ToolKind,
} from '@agentclientprotocol/sdk';
import type { NormalizedMessage, ToolResultPart } from '../../../message';
import {
  isSlashCommand as neovateIsSlashCommand,
  parseSlashCommand as neovateParseSlashCommand,
} from '../../../slashCommand';
import type { ApprovalCategory } from '../../../tool';

/**
 * Convert ACP ContentBlock[] to Neovate message format
 */
export function fromACP(prompt: ContentBlock[]): string {
  return prompt
    .filter((block) => block.type === 'text')
    .map((block) => (block as any).text)
    .join('\n');
}

/**
 * Extract tool_result parts from a message
 */
export function extractToolResultParts(
  message: NormalizedMessage,
): ToolResultPart[] {
  if (message.role === 'tool' && Array.isArray(message.content)) {
    // Handle ToolMessage2 format (role: 'tool')
    return message.content.map((part: any) => ({
      type: 'tool_result',
      id: part.toolCallId,
      name: part.toolName,
      input: part.input,
      result: part.result,
    }));
  }

  if (message.role === 'user' && Array.isArray(message.content)) {
    // Handle ToolMessage format (role: 'user' with tool_result parts)
    return message.content.filter(
      (part) => part.type === 'tool_result',
    ) as ToolResultPart[];
  }

  return [];
}

/**
 * Get text content from tool result
 */
export function getResultText(result: any): string {
  if (typeof result.returnDisplay === 'string') {
    return result.returnDisplay;
  }

  if (typeof result.llmContent === 'string') {
    return result.llmContent;
  }

  if (Array.isArray(result.llmContent)) {
    return result.llmContent
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('\n');
  }

  return JSON.stringify(result, null, 2);
}

/**
 * Extract diff information from tool result
 */
export function getDiffText(toolResult: ToolResultPart): Diff | undefined {
  if (toolResult.name === 'write' || toolResult.name === 'edit') {
    if (
      toolResult.result?.returnDisplay &&
      typeof toolResult.result.returnDisplay === 'object' &&
      toolResult.result.returnDisplay.type === 'diff_viewer'
    ) {
      const { newContent, originalContent } = toolResult.result
        .returnDisplay as any;

      let newText: string = '';
      let oldText: string = '';

      if (typeof newContent !== 'string') {
        newText = toolResult.input?.[newContent.inputKey];
      } else {
        newText = newContent;
      }

      if (typeof originalContent !== 'string') {
        oldText = toolResult.input?.[originalContent.inputKey];
      } else {
        oldText = originalContent;
      }

      return {
        path:
          (toolResult.result.returnDisplay as any).absoluteFilePath ||
          (toolResult.result.returnDisplay as any).filePath ||
          '',
        newText,
        oldText,
      };
    }
  }
}

/**
 * Convert Neovate ToolResult to ACP ToolCallContent[]
 */
export function toACPToolContent(
  toolResult: ToolResultPart,
): Array<ToolCallContent> {
  const content: Array<ToolCallContent> = [
    {
      type: 'content',
      content: {
        type: 'text',
        text: getResultText(toolResult.result),
      },
    },
  ];

  const diffContent = getDiffText(toolResult);
  if (diffContent) {
    content.push({
      type: 'diff',
      ...diffContent,
    });
  }

  return content;
}

/**
 * Map Neovate ApprovalCategory to ACP ToolKind
 */
export function mapApprovalCategory(category?: ApprovalCategory): ToolKind {
  switch (category) {
    case 'read':
      return 'read';
    case 'write':
      return 'edit';
    case 'command':
      return 'execute';
    case 'network':
      return 'search';
    default:
      return 'read';
  }
}

/**
 * Check if input is a slash command
 * Reuses Neovate's built-in implementation
 */
export const isSlashCommand = neovateIsSlashCommand;

/**
 * Parse slash command
 * Reuses Neovate's built-in implementation
 */
export const parseSlashCommand = neovateParseSlashCommand;
