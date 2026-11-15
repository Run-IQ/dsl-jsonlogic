import { describe, expect, it } from 'vitest';
import { JsonLogicEvaluator } from '../src/index.js';
const evaluator = new JsonLogicEvaluator();
const u = { var: 'absent' };
const states = [true, false, 'unknown'] as const;
const inputs = [true, false, u];
describe('Kleene truth', () => {
  const and = [
    [true, false, 'unknown'],
    [false, false, false],
    ['unknown', false, 'unknown'],
  ];
  const or = [
    [true, true, true],
    [true, false, 'unknown'],
    [true, 'unknown', 'unknown'],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      it(`and ${states[i]} ${states[j]}`, () =>
        expect(evaluator.evaluateTruth({ and: [inputs[i], inputs[j]] }, {})).toEqual({
          value: and[i]![j],
        }));
      it(`or ${states[i]} ${states[j]}`, () =>
        expect(evaluator.evaluateTruth({ or: [inputs[i], inputs[j]] }, {})).toEqual({
          value: or[i]![j],
        }));
    }
  it.each([
    [true, false],
    [false, true],
    [u, 'unknown'],
  ])('not %j', (expression, value) => {
    expect(evaluator.evaluateTruth({ '!': [expression] }, {})).toEqual({ value });
  });
  it.each([
    [{ var: 'x' }, {}, 'unknown'],
    [{ var: ['x', false] }, {}, false],
    [{ var: 'x' }, { x: null }, false],
    ['unknown', {}, true],
    [[], {}, false],
    [{ if: [true, true, { '/': [0, 0] }] }, {}, true],
    [{ if: [false, { '/': [0, 0] }, false] }, {}, false],
    [{ if: [u, true, true] }, {}, true],
    [{ if: [u, false, false] }, {}, false],
    [{ if: [u, true, false] }, {}, 'unknown'],
    [{ '==': [{ if: [u, ['a'], ['a']] }, ['a']] }, {}, false],
  ])('evaluates %j with %j', (expression, context, value) => {
    expect(evaluator.evaluateTruth(expression, context)).toEqual({ value });
  });
  it.each(['in', 'some', 'all', 'none', 'map', 'filter', 'reduce'])(
    '%s preserves an unknown collection',
    (op) => {
      const args =
        op === 'in' ? [1, u] : op === 'reduce' ? [u, { var: 'accumulator' }, 0] : [u, true];
      expect(evaluator.evaluateTruth({ [op]: args }, {})).toEqual({ value: 'unknown' });
    },
  );
  it.each([
    ['some', [true, null], true],
    ['all', [false, null], false],
    ['none', [true, null], false],
    ['some', [false, null], 'unknown'],
    ['all', [true, null], 'unknown'],
    ['none', [false, null], 'unknown'],
  ])('%s handles unknown element predicates', (op, items, value) => {
    expect(
      evaluator.evaluateTruth(
        { [String(op)]: [{ var: 'items' }, { var: 'answer' }] },
        {
          items: (items as (boolean | null)[]).map((answer) => (answer === null ? {} : { answer })),
        },
      ),
    ).toEqual({ value });
  });
  it('decides at least two criteria with two known true and one unknown', () => {
    const expression = {
      '>=': [{ '+': ['a', 'b', 'c'].map((name) => ({ if: [{ var: name }, 1, 0] })) }, 2],
    };
    expect(evaluator.evaluateTruth(expression, { a: true, b: true })).toEqual({ value: true });
    expect(evaluator.evaluateTruth(expression, { a: true, b: false })).toEqual({
      value: 'unknown',
    });
    expect(evaluator.evaluateTruth(expression, { a: false, b: false })).toEqual({ value: false });
  });
});
describe('bounded output comparisons', () => {
  const read = { var: '$outputs.criteres' };
  it.each([
    ['>=', 2, { min: 2, max: 3 }, true],
    ['>=', 2, { min: 1, max: 3 }, 'unknown'],
    ['>=', 2, { max: 1 }, false],
    ['>', 2, { min: 3 }, true],
    ['>', 2, { max: 2 }, false],
    ['<', 2, { max: 1 }, true],
    ['<', 2, { min: 2 }, false],
    ['<=', 2, { max: 2 }, true],
    ['<=', 2, { min: 3 }, false],
    ['==', 2, { min: 2, max: 2 }, true],
    ['==', 2, { min: 3 }, false],
    ['!=', 2, { min: 2, max: 2 }, false],
    ['!=', 2, { max: 1 }, true],
    ['>=', '9', { min: '10' }, true],
    ['>', 9, { min: '10' }, true],
    ['<', '10', { max: '9' }, true],
    ['>', '9007199254740992', { min: '9007199254740993' }, true],
    ['>', '-1.001', { min: '-1.0001' }, true],
  ])('%s %j against %j', (op, rhs, bounds, value) => {
    expect(
      evaluator.evaluateTruth({ [op]: [read, rhs] }, { $bounds: { criteres: bounds } }),
    ).toEqual(value === 'unknown' ? { value } : { value, boundedReads: ['/$outputs/criteres'] });
  });
  it('handles reversed operands and chained inequalities', () => {
    const context = { $bounds: { criteres: { min: 2, max: 3 } } };
    expect(evaluator.evaluateTruth({ '<=': [2, read] }, context)).toEqual({
      value: true,
      boundedReads: ['/$outputs/criteres'],
    });
    expect(evaluator.evaluateTruth({ '<': [1, read, 4] }, context)).toEqual({
      value: true,
      boundedReads: ['/$outputs/criteres'],
    });
  });
  it('ignores bounds for present outputs and ordinary facts', () => {
    expect(
      evaluator.evaluateTruth(
        { '>=': [read, 2] },
        { $outputs: { criteres: 1 }, $bounds: { criteres: { min: 2 } } },
      ),
    ).toEqual({ value: false });
    expect(
      evaluator.evaluateTruth(
        { '>=': [{ var: 'criteres' }, 2] },
        { $bounds: { criteres: { min: 2 } } },
      ),
    ).toEqual({ value: 'unknown' });
  });
  it('does not report bounds that did not decide the final result', () => {
    const bounded = { '>=': [read, 2] };
    const context = { $bounds: { criteres: { min: 2 } } };
    expect(evaluator.evaluateTruth({ and: [bounded, false] }, context)).toEqual({ value: false });
    expect(evaluator.evaluateTruth({ or: [bounded, true] }, context)).toEqual({
      value: true,
      boundedReads: ['/$outputs/criteres'],
    });
    expect(evaluator.evaluateTruth({ '!': [bounded] }, context)).toEqual({
      value: false,
      boundedReads: ['/$outputs/criteres'],
    });
  });
  it.each([{ min: 3, max: 2 }, { min: 'not decimal' }, {}, { typo: 2 }, { min: null }])(
    'refuses malformed bounds %j',
    (bounds) => {
      expect(() =>
        evaluator.evaluateTruth({ '>=': [read, 2] }, { $bounds: { criteres: bounds } }),
      ).toThrowError(expect.objectContaining({ name: 'JsonLogicError', code: 'INVALID_BOUNDS' }));
    },
  );
});

describe('conservative inference boundaries', () => {
  it('does not infer numeric bounds from arbitrary string-valued branches', () => {
    expect(evaluator.evaluateTruth({ '>': [{ if: [u, '9', '10'] }, '2'] }, {})).toEqual({
      value: 'unknown',
    });
  });
  it('does not infer strict equality from a decimal bound with a different JSON type', () => {
    expect(
      evaluator.evaluateTruth(
        { '===': [{ var: '$outputs.x' }, 9] },
        { $bounds: { x: { min: '9', max: '9' } } },
      ),
    ).toEqual({ value: 'unknown' });
  });
  it('uses JSONLogic string ordering for a known link of a partially unknown chain', () => {
    expect(evaluator.evaluateTruth({ '<': ['9', '10', u] }, {})).toEqual({ value: false });
  });
  it('does not reuse scalar accumulator bounds for an absent child property', () => {
    const expression = {
      '>=': [{ reduce: [[1], { var: 'accumulator.child' }, { if: [u, 2, 3] }] }, 2],
    };
    expect(evaluator.evaluateTruth(expression, {})).toEqual({ value: 'unknown' });
  });
  it('gives an empty var the complete reduce scope', () => {
    const expression = { var: 'scope' };
    expect(evaluator.compute({ reduce: [[1], { var: '' }, 0] }, {})).toEqual({
      current: 1,
      accumulator: 0,
    });
    expect(
      evaluator.evaluateTruth({ '==': [{ reduce: [[1], { var: '' }, 0] }, null] }, {}),
    ).toEqual({ value: false });
    expect(evaluator.listVariables(expression)).toEqual(['/scope']);
  });
  it('sorts, escapes and deduplicates the bounds that decided a conjunction', () => {
    const expr = {
      and: [
        { '>=': [{ var: '$outputs.z~/' }, 2] },
        { '>=': [{ var: '$outputs.a' }, 2] },
        { '>=': [{ var: '$outputs.a' }, 2] },
      ],
    };
    expect(
      evaluator.evaluateTruth(expr, { $bounds: { 'z~/': { min: 2 }, a: { min: 2 } } }),
    ).toEqual({ value: true, boundedReads: ['/$outputs/a', '/$outputs/z~0~1'] });
  });
});

it('does not read inherited properties from the reduce scope', () => {
  expect(evaluator.evaluateTruth({ reduce: [[1], { var: 'constructor' }, 0] }, {})).toEqual({
    value: 'unknown',
  });
});
it('evaluates wide flat conditionals without consuming call-stack depth', () => {
  const knownArgs: unknown[] = [],
    unknownArgs: unknown[] = [];
  for (let i = 0; i < 20000; i++) {
    knownArgs.push(false, false);
    unknownArgs.push(u, true);
  }
  knownArgs.push(true);
  unknownArgs.push(true);
  expect(evaluator.evaluateTruth({ if: knownArgs }, {})).toEqual({ value: true });
  expect(evaluator.evaluateTruth({ if: unknownArgs }, {})).toEqual({ value: true });
});

it('does not apply output bounds to a missing nested ordinary fact', () => {
  expect(
    evaluator.evaluateTruth(
      { '>=': [{ var: 'input.criteres' }, 2] },
      { $bounds: { criteres: { min: 2 } } },
    ),
  ).toEqual({ value: 'unknown' });
});
it('merges equal JSON branches independently of object key order', () => {
  expect(evaluator.evaluateTruth({ if: [u, { a: 1, b: 2 }, { b: 2, a: 1 }] }, {})).toEqual({
    value: true,
  });
});

describe('review regressions', () => {
  it.each([{ '!=': [{ or: [0, 2] }, 2] }, { '!=': [{ and: [1, 2] }, 2] }])(
    'preserves known logical operand values: %j',
    (expression) => {
      expect(evaluator.compute(expression, {})).toBe(false);
      expect(evaluator.evaluateTruth(expression, {})).toEqual({ value: false });
    },
  );
  it('keeps unknown logical operand values uncertain inside a comparison', () => {
    expect(evaluator.evaluateTruth({ '==': [{ and: [u, 0] }, 0] }, {})).toEqual({
      value: 'unknown',
    });
    expect(evaluator.evaluateTruth({ '!': [{ and: [u, 0] }] }, {})).toEqual({ value: true });
  });
  it.each([
    { '!': [{ missing_some: [{ var: 'need' }, ['x']] }] },
    { '!': [{ missing_some: [1, { if: [u, ['x'], []] }] }] },
  ])('does not collapse unknown missing arguments: %j', (expression) => {
    expect(evaluator.evaluateTruth(expression, {})).toEqual({ value: 'unknown' });
  });
  it('checks missing keys in the reduce scope', () => {
    expect(evaluator.evaluateTruth({ reduce: [[1], { missing: ['current'] }, []] }, {})).toEqual({
      value: false,
    });
  });
  it('retains evidence for reduce child and nonarray-source reads', () => {
    const bounded = { '>=': [{ var: '$outputs.x' }, 2] };
    const context = { $bounds: { x: { min: 2 } } };
    expect(
      evaluator.evaluateTruth({ reduce: [[1], { var: 'accumulator.0' }, [bounded]] }, context),
    ).toEqual({ value: true, boundedReads: ['/$outputs/x'] });
    expect(
      evaluator.evaluateTruth({ reduce: [{ if: [bounded, 0, [1]] }, false, true] }, context),
    ).toEqual({ value: true, boundedReads: ['/$outputs/x'] });
  });
  it.each([{ '==': [{ var: 's.length' }, 3] }, { '==': [{ var: 's.0' }, 'a'] }])(
    'resolves own string properties: %j',
    (expression) => {
      expect(evaluator.evaluateTruth(expression, { s: 'abc' })).toEqual({ value: true });
    },
  );
  it('does not use a default for an unresolved accumulator that is present', () => {
    expect(
      evaluator.evaluateTruth(
        { '==': [{ reduce: [[1], { var: ['accumulator', 0] }, { if: [u, 2, 3] }] }, 0] },
        {},
      ),
    ).toEqual({ value: false });
  });
});

it('retains bounds for exact operand selection while dropping irrelevant truth evidence', () => {
  const bounded = { '>=': [{ var: '$outputs.x' }, 2] };
  const context = { $bounds: { x: { max: 1 } } };
  expect(evaluator.evaluateTruth({ '==': [{ or: [bounded, 2] }, 2] }, context)).toEqual({
    value: true,
    boundedReads: ['/$outputs/x'],
  });
  expect(evaluator.evaluateTruth({ or: [bounded, true] }, context)).toEqual({ value: true });
});

it.each([{ var: ['accumulator.x', true] }, { missing: ['accumulator.x'] }])(
  'retains evidence establishing absence for %j',
  (body) => {
    const initial = {
      if: [{ '>=': [{ var: '$outputs.x' }, 2] }, { a: 1, b: 2 }, { x: false, a: 0 }],
    };
    expect(
      evaluator.evaluateTruth({ reduce: [[1], body, initial] }, { $bounds: { x: { min: 2 } } }),
    ).toEqual({ value: true, boundedReads: ['/$outputs/x'] });
  },
);
