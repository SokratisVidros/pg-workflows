import { describe, expect, it } from 'vitest';
import { WorkflowEngineError } from './error';
import { PRIORITY_LEVELS, resolvePriority } from './priority';

describe('resolvePriority', () => {
  describe('named levels', () => {
    it('maps named levels to their integer values', () => {
      expect(resolvePriority('high')).toBe(100);
      expect(resolvePriority('normal')).toBe(0);
      expect(resolvePriority('low')).toBe(-100);
    });

    it('exposes the level mapping as a frozen table', () => {
      expect(PRIORITY_LEVELS).toEqual({ high: 100, normal: 0, low: -100 });
    });
  });

  describe('numeric escape hatch', () => {
    it('passes integers through unchanged', () => {
      expect(resolvePriority(250)).toBe(250);
      expect(resolvePriority(0)).toBe(0);
      expect(resolvePriority(-50)).toBe(-50);
    });

    it('throws on non-integer numbers', () => {
      expect(() => resolvePriority(1.5)).toThrow(WorkflowEngineError);
    });

    it('throws on non-finite numbers', () => {
      expect(() => resolvePriority(Number.NaN)).toThrow(WorkflowEngineError);
      expect(() => resolvePriority(Number.POSITIVE_INFINITY)).toThrow(WorkflowEngineError);
    });
  });

  describe('invalid input', () => {
    it('throws on an unknown named level', () => {
      // @ts-expect-error runtime guard for dynamic values
      expect(() => resolvePriority('urgent')).toThrow(WorkflowEngineError);
    });
  });

  describe('precedence chain', () => {
    it('returns the first defined candidate', () => {
      expect(resolvePriority('low', 'high')).toBe(-100);
      expect(resolvePriority(undefined, 'high')).toBe(100);
      expect(resolvePriority(undefined, undefined, 42)).toBe(42);
    });

    it('defaults to normal (0) when nothing is defined', () => {
      expect(resolvePriority()).toBe(0);
      expect(resolvePriority(undefined, undefined)).toBe(0);
    });

    it('treats an explicit 0 as defined, not a fallthrough', () => {
      expect(resolvePriority(0, 'high')).toBe(0);
    });
  });
});
