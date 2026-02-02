/**
 * Tool Call History Manager
 * Maintains a history of tool calls with a maximum size limit (FIFO)
 */

import type { SessionUpdate, ToolCall } from '@agentclientprotocol/sdk';

type ToolCallUpdate = ToolCall & {
  sessionUpdate: 'tool_call';
};
export class ToolCallHistory {
  private history: Map<string, ToolCallUpdate> = new Map();
  private readonly maxSize: number;

  /**
   * Creates a new ToolCallHistory instance
   * @param maxSize Maximum number of tool calls to store (default: 100)
   */
  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Add a tool call to history
   * If the history is full, removes the oldest entry (FIFO)
   * @param toolCallId The unique identifier for the tool call
   * @param title The title/description of the tool call
   */
  add(toolCallId: string, update: ToolCallUpdate): void {
    // If we've reached the max size, remove the oldest entry
    if (this.history.size >= this.maxSize) {
      const firstKey = this.history.keys().next().value;
      if (firstKey) {
        this.history.delete(firstKey);
      }
    }
    this.history.set(toolCallId, update);
  }

  /**
   * Get the title for a specific tool call ID
   * @param toolCallId The tool call ID to look up
   * @returns The title if found, undefined otherwise
   */
  get(toolCallId: string): ToolCallUpdate | undefined {
    return this.history.get(toolCallId);
  }

  /**
   * Check if a tool call ID exists in history
   * @param toolCallId The tool call ID to check
   * @returns True if the ID exists in history
   */
  has(toolCallId: string): boolean {
    return this.history.has(toolCallId);
  }

  /**
   * Remove a specific tool call from history
   * @param toolCallId The tool call ID to remove
   * @returns True if the entry was removed, false if it didn't exist
   */
  remove(toolCallId: string): boolean {
    return this.history.delete(toolCallId);
  }

  /**
   * Clear all tool call history
   */
  clear(): void {
    this.history.clear();
  }

  /**
   * Get the current size of the history
   * @returns The number of entries in history
   */
  size(): number {
    return this.history.size;
  }

  /**
   * Get all tool call IDs in history
   * @returns Array of tool call IDs in insertion order
   */
  getAllIds(): string[] {
    return Array.from(this.history.keys());
  }

  /**
   * Get all entries in history
   * @returns Array of [toolCallId, title] tuples in insertion order
   */
  getAllEntries(): Array<[string, ToolCallUpdate]> {
    return Array.from(this.history.entries());
  }
}
