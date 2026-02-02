/**
 * ACP Integration Tests
 * Basic smoke tests for ACP protocol support
 */

import { describe, expect, it } from 'vitest';
import {
  fromACP,
  getResultText,
  mapApprovalCategory,
} from './utils/messageAdapter';

describe('ACP Message Adapter', () => {
  describe('fromACP', () => {
    it('should convert text content blocks to string', () => {
      const blocks = [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ];
      expect(fromACP(blocks as any)).toBe('Hello\nWorld');
    });

    it('should filter out non-text blocks', () => {
      const blocks = [
        { type: 'text', text: 'Hello' },
        { type: 'image', data: 'base64...' },
        { type: 'text', text: 'World' },
      ];
      expect(fromACP(blocks as any)).toBe('Hello\nWorld');
    });

    it('should return empty string for no text blocks', () => {
      const blocks = [{ type: 'image', data: 'base64...' }];
      expect(fromACP(blocks as any)).toBe('');
    });
  });

  describe('getResultText', () => {
    it('should extract string returnDisplay', () => {
      const result = { returnDisplay: 'Test output' };
      expect(getResultText(result)).toBe('Test output');
    });

    it('should extract string llmContent', () => {
      const result = { llmContent: 'LLM response' };
      expect(getResultText(result)).toBe('LLM response');
    });

    it('should extract text from array llmContent', () => {
      const result = {
        llmContent: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
      };
      expect(getResultText(result)).toBe('Hello\nWorld');
    });

    it('should stringify complex objects', () => {
      const result = { data: { foo: 'bar' } };
      expect(getResultText(result)).toContain('foo');
      expect(getResultText(result)).toContain('bar');
    });
  });

  describe('mapApprovalCategory', () => {
    it('should map read category', () => {
      expect(mapApprovalCategory('read')).toBe('read');
    });

    it('should map write category to edit', () => {
      expect(mapApprovalCategory('write')).toBe('edit');
    });

    it('should map command category to execute', () => {
      expect(mapApprovalCategory('command')).toBe('execute');
    });

    it('should map network category to search', () => {
      expect(mapApprovalCategory('network')).toBe('search');
    });

    it('should default to read for unknown categories', () => {
      expect(mapApprovalCategory(undefined)).toBe('read');
      expect(mapApprovalCategory('unknown' as any)).toBe('read');
    });
  });
});
