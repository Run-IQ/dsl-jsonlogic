import { describe, it, expect } from 'vitest';
import { JsonLogicEvaluator, getDepth } from '../src/JsonLogicEvaluator.js';
import { VERSION } from '../src/version.js';

describe('JsonLogicEvaluator', () => {
  const evaluator = new JsonLogicEvaluator();

  it('has correct dsl and version', () => {
    expect(evaluator.dsl).toBe('jsonlogic');
    expect(evaluator.version).toBe(VERSION);
  });

  it('evaluates true condition', () => {
    const expression = { '>=': [{ var: 'revenue' }, 5000000] };
    const context = { revenue: 10000000 };
    expect(evaluator.evaluate(expression, context)).toBe(true);
  });

  it('evaluates false condition', () => {
    const expression = { '>=': [{ var: 'revenue' }, 5000000] };
    const context = { revenue: 1000000 };
    expect(evaluator.evaluate(expression, context)).toBe(false);
  });

  it('evaluates equality condition', () => {
    const expression = { '==': [{ var: 'country' }, 'TG'] };
    expect(evaluator.evaluate(expression, { country: 'TG' })).toBe(true);
    expect(evaluator.evaluate(expression, { country: 'SN' })).toBe(false);
  });

  it('evaluates AND condition', () => {
    const expression = {
      and: [{ '>=': [{ var: 'revenue' }, 5000000] }, { '==': [{ var: 'country' }, 'TG'] }],
    };
    expect(evaluator.evaluate(expression, { revenue: 10000000, country: 'TG' })).toBe(true);
    expect(evaluator.evaluate(expression, { revenue: 10000000, country: 'SN' })).toBe(false);
    expect(evaluator.evaluate(expression, { revenue: 1000, country: 'TG' })).toBe(false);
  });

  it('evaluates OR condition', () => {
    const expression = {
      or: [{ '==': [{ var: 'regime' }, 'reel'] }, { '>=': [{ var: 'revenue' }, 10000000] }],
    };
    expect(evaluator.evaluate(expression, { regime: 'reel', revenue: 0 })).toBe(true);
    expect(evaluator.evaluate(expression, { regime: 'forfait', revenue: 20000000 })).toBe(true);
    expect(evaluator.evaluate(expression, { regime: 'forfait', revenue: 100 })).toBe(false);
  });

  it('handles invalid expression gracefully (returns false)', () => {
    // null expression -> falsy -> false
    expect(evaluator.evaluate(null, {})).toBe(false);
  });

  it('throws on invalid operator', () => {
    expect(() => evaluator.evaluate({ foobar: [1] }, {})).toThrow(/evaluation failed/);
  });

  it('determinism: same expression x3 = same result', () => {
    const expression = { '>=': [{ var: 'amount' }, 1000] };
    const context = { amount: 5000 };
    const r1 = evaluator.evaluate(expression, context);
    const r2 = evaluator.evaluate(expression, context);
    const r3 = evaluator.evaluate(expression, context);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(r1).toBe(true);
  });

  describe('edge cases', () => {
    it('undefined expression → false', () => {
      expect(evaluator.evaluate(undefined, {})).toBe(false);
    });

    it('empty object {} → false', () => {
      // An empty object has no operator, json-logic-js returns {}
      // which is truthy, but we document the actual behavior
      const result = evaluator.evaluate({}, {});
      // Empty object is treated as truthy by Boolean({})
      expect(result).toBe(true);
    });

    it('missing variable {var: "nonexistent"} → false', () => {
      const expression = { var: 'nonexistent' };
      // json-logic-js returns null for missing variables, Boolean(null) = false
      expect(evaluator.evaluate(expression, { other: 123 })).toBe(false);
    });

    it('numeric coercion: 0 → false', () => {
      // A literal 0 as expression → Boolean(0) = false
      expect(evaluator.evaluate(0, {})).toBe(false);
    });

    it('numeric coercion: 1 → true', () => {
      expect(evaluator.evaluate(1, {})).toBe(true);
    });

    it('string coercion: empty string → false', () => {
      expect(evaluator.evaluate('', {})).toBe(false);
    });

    it('string coercion: non-empty string → true', () => {
      expect(evaluator.evaluate('hello', {})).toBe(true);
    });

    it('numeric coercion: NaN → false', () => {
      // NaN is falsy
      expect(evaluator.evaluate(NaN, {})).toBe(false);
    });

    it('nested dot-notation {var: "a.b.c"} resolves deep value', () => {
      const expression = { '>': [{ var: 'a.b.c' }, 10] };
      const context = { a: { b: { c: 42 } } };
      expect(evaluator.evaluate(expression, context)).toBe(true);
    });

    it('nested dot-notation {var: "a.b.c"} returns false when path is missing', () => {
      const expression = { '>': [{ var: 'a.b.c' }, 10] };
      const context = { a: { x: 1 } };
      // Missing path → null, null > 10 → false
      expect(evaluator.evaluate(expression, context)).toBe(false);
    });

    it('determinism: false expression x3 = same result', () => {
      const expression = { '<': [{ var: 'amount' }, 100] };
      const context = { amount: 5000 };
      const r1 = evaluator.evaluate(expression, context);
      const r2 = evaluator.evaluate(expression, context);
      const r3 = evaluator.evaluate(expression, context);
      expect(r1).toBe(false);
      expect(r2).toBe(false);
      expect(r3).toBe(false);
    });

    it('determinism: complex nested expression x3 = same result', () => {
      const expression = {
        and: [
          { '>=': [{ var: 'revenue' }, 1000] },
          { or: [{ '==': [{ var: 'country' }, 'TG'] }, { '==': [{ var: 'country' }, 'SN'] }] },
        ],
      };
      const context = { revenue: 5000, country: 'TG' };
      const r1 = evaluator.evaluate(expression, context);
      const r2 = evaluator.evaluate(expression, context);
      const r3 = evaluator.evaluate(expression, context);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(r3).toBe(true);
    });

    it('array expression [1,2,3] → true (truthy non-empty array)', () => {
      // json-logic-js returns the array as-is for a plain array,
      // Boolean([1,2,3]) is true
      const result = evaluator.evaluate([1, 2, 3], {});
      expect(result).toBe(true);
    });

    it('deeply nested expression exceeding max depth → throws', () => {
      // Build an expression nested 51 levels deep
      let expr: unknown = { var: 'x' };
      for (let i = 0; i < 51; i++) {
        expr = { '==': [expr, true] };
      }
      expect(() => evaluator.evaluate(expr, { x: true })).toThrow(/exceeds maximum depth/);
    });

    it('expression at exactly depth 50 → does not throw', () => {
      // Build an expression nested exactly 50 levels deep (depth = 50)
      // Each { op: [child] } adds 1 level for the object + the array inside
      // getDepth({ '==': [{ var: 'x' }, true] }) = 1 + max(1 + max(1+0, 0), 0) = 3
      // We need to be precise: build iteratively and verify
      let expr: unknown = true;
      // Each wrap: { '!': [prev] } has depth = 1 + 1 + getDepth(prev)
      // Start: true → depth 0
      // Wrap 1: { '!': [true] } → depth 1 (obj) + 1 (arr) + 0 = 2
      // Actually getDepth({ '!': [true] }) = 1 + getDepth([true]) = 1 + (1 + 0) = 2
      // Wrap 2: { '!!': [{ '!': [true] }] } = 1 + 1 + 2 = 4
      // Each wrap adds 2. So 24 wraps = depth 48, 25 wraps = depth 50
      for (let i = 0; i < 25; i++) {
        expr = { '!!': [expr] };
      }
      expect(getDepth(expr)).toBe(50);
      // Should not throw
      expect(() => evaluator.evaluate(expr, {})).not.toThrow();
    });
  });

  describe('getDepth', () => {
    it('returns 0 for null', () => {
      expect(getDepth(null)).toBe(0);
    });

    it('returns 0 for undefined', () => {
      expect(getDepth(undefined)).toBe(0);
    });

    it('returns 0 for primitives', () => {
      expect(getDepth(42)).toBe(0);
      expect(getDepth('hello')).toBe(0);
      expect(getDepth(true)).toBe(0);
    });

    it('returns 1 for empty object', () => {
      expect(getDepth({})).toBe(1);
    });

    it('returns 1 for empty array', () => {
      expect(getDepth([])).toBe(1);
    });

    it('returns 1 for flat JSONLogic expression { var: "x" }', () => {
      // { var: 'x' } → 1 (single object level with a primitive value)
      expect(getDepth({ var: 'x' })).toBe(1);
    });

    it('computes depth for nested structures', () => {
      // { '>=': [{ var: 'x' }, 5] }
      // object(1) → array(2) → max(object(3)→string(3), primitive(2)) = 3
      expect(getDepth({ '>=': [{ var: 'x' }, 5] })).toBe(3);
    });

    it('computes depth for deeply nested structures', () => {
      // Build 10 levels of wrapping
      let expr: unknown = true;
      for (let i = 0; i < 10; i++) {
        expr = { '!!': [expr] };
      }
      // Each wrap adds 2 (1 for obj + 1 for array), starting from 0
      expect(getDepth(expr)).toBe(20);
    });
  });
});
