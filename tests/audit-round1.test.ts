import { describe, expect, it, vi } from 'vitest';
import jsonLogic from 'json-logic-js';
import { JsonLogicEvaluator } from '../src/index.js';
const e = new JsonLogicEvaluator();
const error = (code: string) => expect.objectContaining({ name: 'JsonLogicError', code });
describe('audit round 1 regressions', () => {
  it.each([
    ['>', '10', '9', true],
    ['<', '9', '10', true],
    ['>', '10.00000000000000001', 10, true],
    ['==', 0.1, '0.10000000000000000555', false],
    ['===', '10', 10, true],
    ['!=', true, 1, true],
    ['==', null, false, false],
  ])('L1 agrees for known and bounded %s %s %s', (op, value, other, expected) => {
    const expr = { [op]: [{ var: '$outputs.x' }, other] };
    const context = { $outputs: { x: value } };
    expect(e.compute(expr, context)).toBe(expected);
    expect(e.evaluate(expr, context)).toBe(expected);
    expect(e.evaluateTruth(expr, context)).toEqual({ value: expected });
    if (typeof value !== 'boolean' && value !== null)
      expect(e.evaluateTruth(expr, { $bounds: { x: { min: value, max: value } } })).toEqual({
        value: expected,
        boundedReads: ['/$outputs/x'],
      });
  });
  it.each([
    ['a', 'b'],
    [true, 1],
    [null, 0],
    ['text', 3],
  ])('L1 refuses incomparable ordering %j %j', (a, b) => {
    for (const method of ['compute', 'evaluate', 'evaluateTruth'] as const)
      expect(() => e[method]({ '<': [a, b] }, {})).toThrowError(error('INCOMPARABLE'));
  });
  it.each([
    [{ cat: ['Hello ', { var: 'name' }] }, {}, '/name'],
    [{ if: [{ var: 'flag' }, 'yes', 'no'] }, {}, '/flag'],
    [{ max: [{ var: 'a' }, 3] }, {}, '/a'],
    [
      { map: [{ var: 'items' }, { var: 'price' }] },
      { items: [{}, { price: 2 }] },
      '/items/0/price',
    ],
  ])('L2 refuses missing facts in %j', (expr, ctx, path) => {
    expect(() => e.compute(expr, ctx)).toThrowError(error('MISSING_FACT'));
    expect(() => e.compute(expr, ctx)).toThrow(String(path));
  });
  it('L3 never defaults a pending output', () => {
    expect(
      e.evaluateTruth(
        { '>=': [{ var: ['$outputs.x', 0] }, 1] },
        { $bounds: { x: { min: 2, max: 3 } } },
      ),
    ).toEqual({ value: true, boundedReads: ['/$outputs/x'] });
    expect(
      e.evaluateTruth(
        { if: [{ missing: ['$outputs.x'] }, false, true] },
        { $bounds: { x: { min: 2, max: 3 } } },
      ),
    ).toEqual({ value: 'unknown' });
  });
  it.each(['constructor.name', '__proto__', 'toString', 'map'])(
    'L4 refuses inherited %s on arrays and strings',
    (path) => {
      for (const value of [[], 'x'])
        expect(() => e.compute({ var: `x.${path}` }, { x: value })).toThrowError(
          error('MISSING_FACT'),
        );
    },
  );
  it.each(['and', 'or'])('L5 refuses empty %s on all entry points', (op) => {
    for (const method of ['compute', 'evaluate', 'evaluateTruth'] as const)
      expect(() => e[method]({ [op]: [] }, {})).toThrowError(error('INVALID_EXPRESSION'));
  });
  it('L6 declares frozen finite resource defaults', () => {
    expect(e.capabilities).toEqual({
      exactDecimals: true,
      threeValued: true,
      limits: {
        maxNodes: 100000,
        maxDepth: 50,
        maxSteps: 100000,
      },
    });
    expect(Object.isFrozen(e.capabilities)).toBe(true);
    expect(Object.isFrozen(e.capabilities.limits)).toBe(true);
    expect(Object.keys(e.capabilities)).toEqual(['exactDecimals', 'threeValued', 'limits']);
    for (const value of Object.values(e.capabilities.limits)) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
  it('L6 counts expanded shared expression nodes before walking them', () => {
    let expr: unknown = 1;
    for (let i = 0; i < 18; i++) expr = { '+': [expr, expr] };
    for (const method of ['listVariables', 'compute', 'evaluateTruth', 'evaluate'] as const)
      expect(() =>
        method === 'listVariables' ? e[method](expr) : e[method](expr, {}),
      ).toThrowError(error('LIMIT_EXCEEDED'));
    expect(e.compute({ '+': Array(1000).fill(1) }, {})).toBe(1000);
  });
  it('L6 bounds evaluation work across iterator repetitions', () => {
    expect(() =>
      e.compute(
        { map: [{ var: 'items' }, { '+': Array(200).fill(1) }] },
        { items: Array(1000).fill(1) },
      ),
    ).toThrowError(error('LIMIT_EXCEEDED'));
    expect(e.compute({ map: [{ var: 'items' }, { '+': [1, 2] }] }, { items: [1, 2] })).toEqual([
      3, 3,
    ]);
  });
  it('L6 bounds intermediate values in reduce', () => {
    expect(() =>
      e.compute(
        {
          reduce: [
            { var: 'items' },
            { merge: [{ var: 'accumulator' }, { var: 'accumulator' }] },
            [1],
          ],
        },
        { items: Array(18).fill(1) },
      ),
    ).toThrowError(error('LIMIT_EXCEEDED'));
  });
  it('L7 sorts by decoded spec pointer segments', () => {
    expect(
      e.listVariables([{ var: 'a/b' }, { var: 'a.b' }, { var: 'a-c' }, { var: 'a~' }]),
    ).toEqual(['/a/b', '/a-c', '/a~1b', '/a~0']);
  });
  it.each(['a.-', 'a.\ud800'])('L8 refuses invalid read pointer %j', (path) => {
    for (const method of ['listVariables', 'compute', 'evaluateTruth'] as const)
      expect(() =>
        method === 'listVariables' ? e[method]({ var: path }) : e[method]({ var: path }, {}),
      ).toThrowError(error('INVALID_EXPRESSION'));
  });
  it('L9 refuses a native operator failure by name', () => {
    expect(() => e.compute({ cat: [{ var: 'object' }] }, { object: { a: 1 } })).toThrowError(
      error('EVALUATION_FAILED'),
    );
  });
  it('L9 snapshots truth context and rejects symbols and nonobject contexts', () => {
    expect(() => e.evaluateTruth(true, [] as unknown as Record<string, unknown>)).toThrowError(
      error('INVALID_CONTEXT'),
    );
    const ctx = { x: 1, [Symbol('hidden')]: 2 };
    expect(() => e.evaluateTruth(true, ctx)).toThrowError(error('INVALID_CONTEXT'));
    expect(() => e.evaluateTruth(true, { x: undefined })).toThrowError(error('INVALID_CONTEXT'));
  });
  it('L9 strict boundary and nonpoint equality stay unknown', () => {
    expect(
      e.evaluateTruth({ '>': [{ var: '$outputs.x' }, 2] }, { $bounds: { x: { min: 2, max: 3 } } }),
    ).toEqual({ value: 'unknown' });
    expect(
      e.evaluateTruth({ '==': [{ var: '$outputs.x' }, 2] }, { $bounds: { x: { min: 2, max: 3 } } }),
    ).toEqual({ value: 'unknown' });
  });
  it('L9 never reads root bounds in iterator bodies', () => {
    expect(
      e.evaluateTruth(
        { some: [{ var: 'items' }, { '>': [{ var: '$outputs.x' }, 2] }] },
        { items: [{}], $bounds: { x: { min: 3, max: 4 } } },
      ),
    ).toEqual({ value: 'unknown' });
  });
  it('L9 refuses overflowing interval sums', () => {
    expect(() =>
      e.evaluateTruth(
        { '>': [{ '+': [{ var: '$outputs.x' }, Number.MAX_VALUE] }, 0] },
        { $bounds: { x: { min: Number.MAX_VALUE, max: Number.MAX_VALUE } } },
      ),
    ).toThrowError(error('NON_JSON_RESULT'));
  });
  it('L9 missing_some stays uncertain when pending keys can satisfy it', () => {
    expect(
      e.evaluateTruth(
        { missing_some: [1, ['absent', '$outputs.x']] },
        { $bounds: { x: { min: 2, max: 3 } } },
      ),
    ).toEqual({ value: 'unknown' });
  });
  it.each([{ $bounds: [] }, { $bounds: { y: 'garbage' } }, { $outputs: 5 }])(
    'L10 validates reserved context shapes even when unused %j',
    (ctx) => {
      expect(() => e.evaluateTruth(true, ctx)).toThrowError(
        error('$bounds' in ctx ? 'INVALID_BOUNDS' : 'INVALID_CONTEXT'),
      );
    },
  );
  it('L10 refuses present outputs outside bounds', () => {
    expect(() =>
      e.evaluateTruth(true, { $outputs: { x: 10 }, $bounds: { x: { max: 3 } } }),
    ).toThrowError(error('INVALID_BOUNDS'));
  });
});
describe('audit resource and operator boundaries', () => {
  it('L6 spends steps while inspecting missing paths in repeated bodies', () => {
    const keys = Array.from({ length: 200 }, (_, i) => `x${i}`);
    expect(() =>
      e.compute(
        { reduce: [{ var: 'items' }, { missing: keys }, []] },
        { items: Array(600).fill({}) },
      ),
    ).toThrowError(error('LIMIT_EXCEEDED'));
  });
  it('L1 supports inclusive between identically on all methods and bounds', () => {
    const expr = { between: ['9', { var: '$outputs.x' }, '11'] };
    expect(e.compute(expr, { $outputs: { x: '10' } })).toBe(true);
    expect(e.evaluate(expr, { $outputs: { x: '10' } })).toBe(true);
    expect(e.evaluateTruth(expr, { $bounds: { x: { min: '9', max: '11' } } })).toEqual({
      value: true,
      boundedReads: ['/$outputs/x'],
    });
  });
  it('L1 refuses a text endpoint against a pending numeric output', () => {
    expect(() =>
      e.evaluateTruth(
        { '<': [{ var: '$outputs.x' }, 'text'] },
        { $bounds: { x: { min: 1, max: 2 } } },
      ),
    ).toThrowError(error('INCOMPARABLE'));
  });
});
describe('audit review resource and comparison regressions', () => {
  it.each(['<', '<=', 'between'])(
    'refuses an incomparable later pair of %s even after a false pair',
    (op) => {
      for (const method of ['compute', 'evaluate', 'evaluateTruth'] as const)
        expect(() => e[method]({ [op]: [3, 2, 'text'] }, {})).toThrowError(error('INCOMPARABLE'));
    },
  );
  it('enforces intermediate map value limits in truth evaluation too', () => {
    const body = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`x${i}`, i]));
    for (const method of ['compute', 'evaluateTruth', 'evaluate'] as const)
      expect(() =>
        e[method]({ map: [{ var: 'items' }, body] }, { items: Array(1000).fill(1) }),
      ).toThrowError(error('LIMIT_EXCEEDED'));
  });
});
it('rejects intermediate reduce depth in truth evaluation', () => {
  expect(() =>
    e.evaluateTruth(
      { reduce: [{ var: 'items' }, [{ var: 'accumulator' }], 0] },
      { items: Array(60).fill(1) },
    ),
  ).toThrowError(error('NON_JSON_RESULT'));
});
it('checks a literal empty array before applying the legacy boolean boundary', () => {
  const expression: unknown[] = [];
  Object.defineProperty(expression, Symbol('hidden'), { value: 1 });
  expect(() => e.evaluate(expression, {})).toThrowError(error('INVALID_EXPRESSION'));
});

it('refuses oversized native work before invoking the allocator', () => {
  const apply = vi.spyOn(jsonLogic, 'apply');
  try {
    expect(() =>
      e.compute(
        { merge: Array.from({ length: 4 }, () => ({ var: 'items' })) },
        { items: Array(15000).fill(1) },
      ),
    ).toThrowError(error('LIMIT_EXCEEDED'));
    expect(apply).not.toHaveBeenCalled();
  } finally {
    apply.mockRestore();
  }
});
it('enforces node limits on wide unshared trees with a margin', () => {
  expect(e.listVariables(Array(1000).fill(1))).toEqual([]);
  expect(() => e.listVariables(Array(100001).fill(1))).toThrowError(error('LIMIT_EXCEEDED'));
  expect(() => e.evaluateTruth(true, { items: Array(100001).fill(1) })).toThrowError(
    error('LIMIT_EXCEEDED'),
  );
});
it('preserves strict object identity across validated native operations', () => {
  const expression = {
    '===': [{ var: 'x' }, { reduce: [{ merge: [[{ var: 'x' }]] }, { var: 'current' }, null] }],
  };
  const context = { x: { a: 1 } };
  expect(e.compute(expression, context)).toBe(true);
  expect(e.evaluate(expression, context)).toBe(true);
  expect(e.evaluateTruth(expression, context)).toEqual({ value: true });
});
it('charges text work before repeated native concatenation can grow exponentially', () => {
  expect(() =>
    e.compute(
      {
        reduce: [{ var: 'items' }, { cat: [{ var: 'accumulator' }, { var: 'accumulator' }] }, 'x'],
      },
      { items: Array(20).fill(1) },
    ),
  ).toThrowError(error('LIMIT_EXCEEDED'));
});
