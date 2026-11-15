# @run-iq/dsl-jsonlogic

Lets [Run-IQ](https://github.com/Run-IQ/core) rules use [JSONLogic](https://jsonlogic.com) expressions as conditions. A rule only applies when its condition is true for the input data.

[`@run-iq/core`](https://github.com/Run-IQ/core) does not evaluate conditions itself. It hands each `condition` to the evaluator registered for its `dsl` name, and this package is the evaluator for `'jsonlogic'`.

## Install

```bash
npm install @run-iq/dsl-jsonlogic@next @run-iq/core@next
```

`@run-iq/core` is a peer dependency. Install the whole `@run-iq` set from the `next` tag, the line built on [`@run-iq/spec`](https://github.com/Run-IQ/spec). Requires Node.js 20 or later.

## Example

```ts
import { PPEEngine, computeRuleChecksum } from '@run-iq/core';
import { JsonLogicEvaluator } from '@run-iq/dsl-jsonlogic';

const fixed = {
  name: 'FIXED',
  version: '1.0.0',
  validateParams: (p) => ({ valid: typeof p?.amount === 'number' }),
  calculate: (_input, _rule, p) => p.amount,
};

const engine = new PPEEngine({
  plugins: [{ name: 'demo', version: '1.0.0', onInit: (ctx) => ctx.modelRegistry.register(fixed) }],
  dsls: [new JsonLogicEvaluator()],
});

const draft = {
  id: 'gold-bonus',
  version: 1,
  model: 'FIXED',
  params: { amount: 5 },
  condition: {
    dsl: 'jsonlogic',
    value: {
      and: [{ '>=': [{ var: 'orderTotal' }, 100] }, { '==': [{ var: 'customer.tier' }, 'gold'] }],
    },
  },
  priority: 1,
  effectiveFrom: new Date('2025-01-01'),
  effectiveUntil: null,
  tags: [],
};
const rule = { ...draft, checksum: computeRuleChecksum(draft) };

const meta = { tenantId: 'acme', effectiveDate: new Date('2025-06-01') };

const gold = await engine.evaluate([rule], {
  requestId: 'a',
  data: { orderTotal: 120, customer: { tier: 'gold' } },
  meta,
});
gold.value; // 5

const basic = await engine.evaluate([rule], {
  requestId: 'b',
  data: { orderTotal: 120, customer: { tier: 'basic' } },
  meta,
});
basic.value; // 0
basic.skippedRules[0].reason; // 'CONDITION_FALSE'
```

`var` reads from the evaluation's `data`, with dot notation for nested fields. All standard JSONLogic operators are available (`==`, `>`, `and`, `or`, `!`, `in`, `if`, arithmetic, ...), except `log`, which is disabled.

## Behaviour

- `evaluate(expression, data)` returns a boolean; unresolved truth becomes false. See the API below for comparisons and missing facts.
- Expressions nested more than 50 levels deep are rejected.
- If an expression throws, the engine skips the rule with reason `DSL_ERROR`.
- `describeSyntax()` returns the supported operators and examples, used by tooling and LLM prompts.

The evaluator can also be used on its own:

```ts
new JsonLogicEvaluator().evaluate({ in: [{ var: 'country' }, ['FR', 'BE']] }, { country: 'FR' }); // true
```

## API

```ts
const evaluator = new JsonLogicEvaluator();
evaluator.listVariables({ '>=': [{ var: 'revenue.total' }, 100] }); // ['/revenue/total']
evaluator.compute({ cat: ['Hello ', { var: 'name' }] }, { name: 'Ada' }); // 'Hello Ada'
evaluator.evaluateTruth({ and: [true, { var: 'missing' }] }, {}); // { value: 'unknown' }
```

`listVariables` returns unique RFC 6901 context pointers, ordered by spec's
`comparePointers` on decoded segments. Dot-separated paths escape `~` and `/`.
A `-` segment or lone surrogate is refused. A defaulted or empty `var` is not
required, but a default expression's own reads remain. Reads inside `some`, `all`,
`none`, `map`, `filter` and `reduce` bodies belong to the current element or
accumulator and are omitted. Collections and reduce initial values contribute
outer reads, including in nested iterators.

`compute` returns detached JSON. A read without a default of an absent own data
property throws `MISSING_FACT`, naming the pointer or iterator index. Inherited
properties are absent. Explicit `null` remains a known value. Defaults apply to
absent facts, never to pending outputs or present unresolved values.

`evaluateTruth` returns `{ value: true | false | 'unknown', boundedReads?: string[] }`.
An absent fact without a default is unknown. `and`, `or` and `!` use Kleene logic;
known logical operands retain their values inside enclosing expressions. A known
`if` evaluates only its chosen branch. An unknown condition yields a known value
only for identical JSON branches; numeric alternatives may contribute conservative
intervals. Unknown collections and predicates remain unknown unless a known
predicate decides the quantifier. `missing` and `missing_some` distinguish absence
from pending values. Empty `and` and `or` are refused by every evaluation method.

All three methods use the same comparisons. Ordering (`<`, `<=`, `>`, `>=`,
`between`) accepts only numbers and canonical decimal strings; other pairs throw
`INCOMPARABLE`. `between` takes `[minimum, value, maximum]` with inclusive endpoints.
Two numeric values compare with spec's `compareOutputValues`; numbers use their
shortest decimal spelling, expanded out of exponent notation when mixed with a
decimal string, matching spec's decimal conversion. No decimal string is converted
to a binary number for comparison. Equality (`==`, `!=`, `===`, `!==`) compares two
numbers/decimals by exact decimal value; all other pairs use strict equality
without coercion.

An output without a value and with an entry in `$bounds` is pending. Its default
is not used, and `missing` is unknown. `$bounds.x` holds `{ min, max }`, with at
least one endpoint: finite numbers or canonical decimal strings. A comparison
is decided only when every admissible value gives the same answer. `$bounds` and
`$outputs` must be objects; every bound is checked up front, including unused
entries, and a present output outside its bounds is refused. Bounds apply only
to the named root output, never to iterator reads or a nested field.

```ts
evaluator.evaluateTruth(
  { '>=': [{ var: '$outputs.criteria' }, 2] },
  { $bounds: { criteria: { min: 2, max: 3 } } },
); // { value: true, boundedReads: ['/$outputs/criteria'] }
```

`boundedReads` lists only bounds that contributed to the returned boolean, sorted
by spec pointer order without duplicates. Unknown results omit it. `evaluate`
returns a boolean and maps unknown to false. Its historical boundary conversions
retain `false` for literal `undefined`/`NaN` and `true` for a literal empty array;
inside expressions empty arrays follow JSONLogic truth semantics.

Every call validates and snapshots the complete expression before execution.
Contexts must be JSON objects. Cycles, holes, accessors, symbols, non-enumerable
properties and non-plain objects are refused; getters are never run. Shared
objects are snapshotted once and charged at every expanded reference. A one-key
object is an operator; zero-key or multi-key literal objects remain data. Unknown
operators, malformed arguments and invalid read paths are refused even in an
unchosen branch. Results cannot contain `undefined`, `NaN` or infinity.

Frozen `capabilities` has exactly `exactDecimals: true`, `threeValued: true` and a
frozen `limits` object. The limits default to `maxNodes: 100000`, `maxDepth: 50`
and `maxSteps: 100000`; every value is a positive safe integer. Nodes include every
JSON value in the expanded expression, context or intermediate/result tree,
including repeated shared subtrees. A step is an expression visit, property
traversal, missing-key inspection, branch-value comparison, or a value visited
during intermediate validation (plus each text code unit). Exceeding a node/work
budget throws `LIMIT_EXCEEDED`; depth overflow throws the appropriate input/result
error. There is no truncation.

Errors are `JsonLogicError` with a named `code`: `INVALID_EXPRESSION`,
`INVALID_CONTEXT`, `INVALID_BOUNDS`, `NON_JSON_RESULT`, `EVALUATION_FAILED`,
`MISSING_FACT`, `INCOMPARABLE` or `LIMIT_EXCEEDED`. The JSON and truth types are
exported with the evaluator.

## Development

The direct dependency `@run-iq/spec` `^1.0.0-next.1` is not published yet. Local
checks need a built `refonte/phase-2` spec linked in place of the locked `next.0`,
which remains solely for the unchanged core peer's transitive installation.
There is no fallback to that old API. Follow the install/build/link procedure in
[CLAUDE.md](CLAUDE.md), then run `npm run ci:local` with Node 20.

## License

MIT
