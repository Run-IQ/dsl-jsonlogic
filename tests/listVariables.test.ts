import { describe, expect, it } from 'vitest';
import { JsonLogicEvaluator } from '../src/index.js';

const evaluator = new JsonLogicEvaluator();
describe('listVariables', () => {
  it.each([
    [{ var: 'revenue.total' }, ['/revenue/total']],
    [{ var: ['revenue.total'] }, ['/revenue/total']],
    [{ var: ['optional', 0] }, []],
    [{ var: '' }, []],
    [{ var: [] }, []],
    [{ var: 0 }, ['/0']],
    [{ var: '$outputs.rgpd:profilage' }, ['/$outputs/rgpd:profilage']],
    [{ var: 'a/b.c~d' }, ['/a~1b/c~0d']],
    [{ var: 'a..b' }, ['/a//b']],
    [{ if: [{ var: 'z' }, { var: 'a' }, { var: 'z' }] }, ['/a', '/z']],
    [{ and: [{ var: 'z' }, { var: 'a' }, { var: 'z' }] }, ['/a', '/z']],
    [{ var: ['optional', { var: 'fallback' }] }, ['/fallback']],
  ])('finds required context reads in %j', (expression, expected) => {
    expect(evaluator.listVariables(expression)).toEqual(expected);
  });
  it.each(['some', 'all', 'none', 'map', 'filter'])('keeps %s element reads scoped', (op) => {
    expect(evaluator.listVariables({ [op]: [{ var: 'items' }, { var: 'price' }] })).toEqual([
      '/items',
    ]);
  });
  it('keeps reduce current/accumulator reads scoped but includes its outer initial value', () => {
    expect(
      evaluator.listVariables({
        reduce: [
          { var: 'items' },
          { '+': [{ var: 'accumulator' }, { var: 'current.amount' }] },
          { var: 'initial' },
        ],
      }),
    ).toEqual(['/initial', '/items']);
  });
  it('does not promote nested iterator reads back to root scope', () => {
    expect(
      evaluator.listVariables({
        map: [{ var: 'items' }, { some: [{ var: 'children' }, { var: 'age' }] }],
      }),
    ).toEqual(['/items']);
  });
  it('checks invalid expressions inside an element scope or a default', () => {
    expect(() => evaluator.listVariables({ map: [{ var: 'items' }, { typo: [] }] })).toThrowError(
      expect.objectContaining({ name: 'JsonLogicError', code: 'INVALID_EXPRESSION' }),
    );
    expect(() => evaluator.listVariables({ var: ['x', { typo: [] }] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_EXPRESSION' }),
    );
  });
});

describe('expression validation on every new entry point', () => {
  const bad: unknown[] = [
    { typo: [] },
    { log: 'secret' },
    { var: {} },
    { var: [true] },
    { var: ['x', 0, 1] },
    { var: null },
    undefined,
    NaN,
    Infinity,
    () => 1,
    Symbol('x'),
    1n,
    new Date(),
    Object.create({ x: 1 }),
    [undefined],
    new Array(1),
  ];
  const cycle: unknown[] = [];
  cycle.push(cycle);
  bad.push(cycle);
  let deep: unknown = true;
  for (let i = 0; i < 26; i++) deep = { '!': [deep] };
  bad.push(deep);
  for (const method of ['listVariables', 'compute', 'evaluateTruth'] as const) {
    it.each(bad.map((expression, i) => [i, expression] as const))(
      `${method} refuses invalid input #%i by name`,
      (_i, expression) => {
        expect(() => evaluator[method](expression, {})).toThrowError(
          expect.objectContaining({ name: 'JsonLogicError', code: 'INVALID_EXPRESSION' }),
        );
      },
    );
  }
  it('accepts depth 50 and rejects 51', () => {
    let expression: unknown = true;
    for (let i = 0; i < 25; i++) expression = { '!': [expression] };
    expect(evaluator.listVariables(expression)).toEqual([]);
    expect(() => evaluator.listVariables([expression])).toThrowError(
      expect.objectContaining({ code: 'INVALID_EXPRESSION' }),
    );
  });
  it('refuses getters without running them, and wraps hostile proxy traps', () => {
    let reads = 0;
    const expression = Object.defineProperty({}, 'var', {
      enumerable: true,
      get() {
        reads++;
        return 'x';
      },
    });
    expect(() => evaluator.listVariables(expression)).toThrowError(
      expect.objectContaining({ code: 'INVALID_EXPRESSION' }),
    );
    expect(reads).toBe(0);
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('trap');
        },
      },
    );
    expect(() => evaluator.listVariables(hostile)).toThrowError(
      expect.objectContaining({ name: 'JsonLogicError', code: 'INVALID_EXPRESSION' }),
    );
  });
  it('permits shared acyclic expressions', () => {
    const shared = { var: 'x' };
    expect(evaluator.listVariables({ and: [shared, shared] })).toEqual(['/x']);
  });
});

it('does not inspect or trust an exception thrown by caller-controlled inspection', () => {
  const thrown = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('second trap');
      },
    },
  );
  const expression = new Proxy(
    {},
    {
      ownKeys() {
        throw thrown;
      },
    },
  );
  expect(() => evaluator.listVariables(expression)).toThrowError(
    expect.objectContaining({ name: 'JsonLogicError', code: 'INVALID_EXPRESSION' }),
  );
});

it('distinguishes a cycle from depth exhaustion', () => {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  expect(() => evaluator.listVariables(cycle)).toThrow(/cycle/);
});

it('snapshots a shared proxy once so both paths use the same value', () => {
  let reads = 0;
  const shared = new Proxy(
    { var: 'x' },
    {
      getOwnPropertyDescriptor(target, key) {
        if (key === 'var') {
          reads++;
          return {
            value: reads === 1 ? 'x' : 'y',
            configurable: true,
            enumerable: true,
            writable: true,
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  expect(evaluator.listVariables({ and: [shared, shared] })).toEqual(['/x']);
  expect(reads).toBe(1);
});

it('does not let a cached shared subtree bypass the depth limit', () => {
  const shared = { '!': [true] };
  let nested: unknown = shared;
  for (let i = 0; i < 48; i++) nested = [nested];
  expect(() => evaluator.listVariables([shared, nested])).toThrow(/maximum depth/);
});
