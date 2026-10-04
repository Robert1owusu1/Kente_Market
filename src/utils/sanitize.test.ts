import { describe, it, expect } from 'vitest';
import { sanitizeString, sanitizeInput } from '../utils/sanitize';

describe('Sanitize Utilities', () => {
  describe('sanitizeString', () => {
    it('trims whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });

    it('handles null/undefined', () => {
      expect(sanitizeString(null)).toBe('');
      expect(sanitizeString(undefined)).toBe('');
    });

    it('converts numbers to strings', () => {
      expect(sanitizeString(123)).toBe('123');
    });

    it('handles empty string', () => {
      expect(sanitizeString('')).toBe('');
    });
  });

  describe('sanitizeInput', () => {
    it('trims whitespace', () => {
      expect(sanitizeInput('  hello  ')).toBe('hello');
    });

    it('strips HTML tags', () => {
      expect(sanitizeInput('<script>alert(1)</script>')).toBe('alert(1)');
      expect(sanitizeInput('<b>bold</b>')).toBe('bold');
      expect(sanitizeInput('hello <img src=x onerror=alert(1)> world')).toBe('hello  world');
    });

    it('limits to 255 characters', () => {
      const long = 'a'.repeat(300);
      expect(sanitizeInput(long)).toHaveLength(255);
    });

    it('handles non-string input', () => {
      expect(sanitizeInput(123)).toBe('');
      expect(sanitizeInput(null)).toBe('');
      expect(sanitizeInput(undefined)).toBe('');
    });

    it('handles empty string', () => {
      expect(sanitizeInput('')).toBe('');
    });
  });
});