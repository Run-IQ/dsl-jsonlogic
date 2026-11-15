import { describe, expect, it } from 'vitest';
import { JsonLogicEvaluator } from '../src/index.js';
const evaluator = new JsonLogicEvaluator();
describe('compute', () => {
  it.each([
    [{ '>=': [{ var: 'x' }, 2] }, { x: 3 }, true],
    [{ map: [{ var: 'items' }, { '*': [{ var: '' }, 2] }] }, { items: [1, 2] }, [2, 4]],
    [{ cat: ['hello ', { var: 'name' }] }, { name: 'world' }, 'hello world'],
    [{ var: ['absent', null] }, {}, null],
  ])('returns a JSON value for %j', (expression, context, value) => {
    expect(evaluator.compute(expression, context)).toEqual(value);
  });
  it.each([{ '/': [0, 0] }, { '/': [1, 0] }, { and: [] }])(
    'refuses non-JSON result %j',
    (expression) => {
      expect(() => evaluator.compute(expression, {})).toThrowError(
        expect.objectContaining({ name: 'JsonLogicError', code: 'NON_JSON_RESULT' }),
      );
    },
  );
  it.each([undefined, NaN, { x: undefined }, { x: () => 1 }, { x: new Date() }])(
    'refuses invalid context %j',
    (context) => {
      expect(() => evaluator.compute(true, context as Record<string, unknown>)).toThrowError(
        expect.objectContaining({ code: 'INVALID_CONTEXT' }),
      );
    },
  );
  it('does not expose caller data through its computed result', () => {
    const context = { items: [1, 2] };
    const result = evaluator.compute({ var: 'items' }, context) as number[];
    result.push(3);
    expect(context).toEqual({ items: [1, 2] });
  });
  it('keeps the existing two-valued evaluation behaviour', () => {
    expect(evaluator.evaluate(undefined, {})).toBe(false);
    expect(evaluator.evaluate([], {})).toBe(true);
    expect(evaluator.evaluate(NaN, {})).toBe(false);
  });
  it('advertises binary arithmetic and three-valued logic', () => {
    expect(evaluator.capabilities).toEqual({ exactDecimals: false, threeValued: true });
    expect(Object.isFrozen(evaluator.capabilities)).toBe(true);
  });
});
