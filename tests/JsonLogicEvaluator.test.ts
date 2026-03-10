import { describe, it, expect } from 'vitest';
import { JsonLogicEvaluator } from '../src/JsonLogicEvaluator.js';
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
});
