import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration';

describe('parseDuration', () => {
  describe('string shorthand', () => {
    it('should parse days shorthand', () => {
      expect(parseDuration('3d')).toBe(3 * 24 * 60 * 60 * 1000);
    });

    it('should parse hours shorthand', () => {
      expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
    });

    it('should parse minutes shorthand', () => {
      expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    });

    it('should parse seconds shorthand', () => {
      expect(parseDuration('45s')).toBe(45 * 1000);
    });
  });

  describe('humanized strings', () => {
    it('should parse "3 days"', () => {
      expect(parseDuration('3 days')).toBe(3 * 24 * 60 * 60 * 1000);
    });

    it('should parse "2 hours"', () => {
      expect(parseDuration('2 hours')).toBe(2 * 60 * 60 * 1000);
    });

    it('should parse "1 week"', () => {
      expect(parseDuration('1 week')).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('compound strings', () => {
    it('should parse "1d 12h"', () => {
      expect(parseDuration('1d 12h')).toBe(36 * 60 * 60 * 1000);
    });

    it('should parse "2 days 12 hours"', () => {
      expect(parseDuration('2 days 12 hours')).toBe(60 * 60 * 60 * 1000);
    });
  });

  describe('DurationObject', () => {
    it('should parse { days: 3 }', () => {
      expect(parseDuration({ days: 3 })).toBe(3 * 24 * 60 * 60 * 1000);
    });

    it('should parse { days: 1, hours: 12 }', () => {
      expect(parseDuration({ days: 1, hours: 12 })).toBe(36 * 60 * 60 * 1000);
    });

    it('should parse { weeks: 1 }', () => {
      expect(parseDuration({ weeks: 1 })).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should parse all fields combined', () => {
      const result = parseDuration({ weeks: 1, days: 2, hours: 3, minutes: 4, seconds: 5 });
      const expected =
        7 * 24 * 60 * 60 * 1000 +
        2 * 24 * 60 * 60 * 1000 +
        3 * 60 * 60 * 1000 +
        4 * 60 * 1000 +
        5 * 1000;
      expect(result).toBe(expected);
    });
  });

  describe('errors', () => {
    it('should throw for empty string', () => {
      expect(() => parseDuration('')).toThrow('Invalid duration: empty string');
    });

    it('should throw for whitespace-only string', () => {
      expect(() => parseDuration('   ')).toThrow('Invalid duration: empty string');
    });

    it('should throw for invalid string', () => {
      expect(() => parseDuration('not-a-duration')).toThrow('Invalid duration');
    });

    it('should throw for empty object', () => {
      expect(() => parseDuration({})).toThrow('Invalid duration: must be a positive value');
    });

    it('should throw for zero-value object', () => {
      expect(() => parseDuration({ days: 0 })).toThrow(
        'Invalid duration: must be a positive value',
      );
    });
  });
});
