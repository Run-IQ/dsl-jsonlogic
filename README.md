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

- `evaluate(expression, data)` returns a boolean. The result of the expression is coerced with `Boolean()`.
- Expressions nested more than 50 levels deep are rejected.
- If an expression throws, the engine skips the rule with reason `DSL_ERROR`.
- `describeSyntax()` returns the supported operators and examples, used by tooling and LLM prompts.

The evaluator can also be used on its own:

```ts
new JsonLogicEvaluator().evaluate({ in: [{ var: 'country' }, ['FR', 'BE']] }, { country: 'FR' }); // true
```

## License

MIT

## Phase 2 standalone API

Task 12 adds three methods without changing the existing two-valued `evaluate`:

```ts
const evaluator = new JsonLogicEvaluator();
evaluator.listVariables({ '>=': [{ var: 'revenue.total' }, 100] }); // ['/revenue/total']
evaluator.compute({ cat: ['Hello ', { var: 'name' }] }, { name: 'Ada' }); // 'Hello Ada'
evaluator.evaluateTruth({ and: [true, { var: 'missing' }] }, {}); // { value: 'unknown' }
evaluator.capabilities; // { exactDecimals: false, threeValued: true }
```

`listVariables` returns sorted, unique RFC 6901 context pointers. It escapes `~`
and `/` in each dot-separated segment. A `var` with a default, or an empty `var`,
is not required. A default expression's own reads are still discovered. Reads in
an iterator's predicate/body (`some`, `all`, `none`, `map`, `filter`, `reduce`) are
relative to its element or accumulator and are omitted. The collection and a
reduce's initial value still contribute outer reads. Nested scopes stay scoped.

`compute` returns a detached JSON value. The new methods validate the complete
expression before executing it: unknown operators (including disabled `log`),
malformed arguments, non-JSON values, cycles and expression depth over 50 are
refused with `JsonLogicError` and `code: 'INVALID_EXPRESSION'`. JSONLogic literal
objects (zero or multiple keys) remain data; a single-key object is an operation.
`var` accepts a string or non-negative safe integer path, an empty argument list,
or `[path, default]`. Contexts must be JSON objects. Context and result trees also
have a maximum depth of 50. Accessors, symbols, non-enumerable data, array holes
and non-plain objects are refused. Inspection faults become named errors without
inspecting the thrown value. The validated copies are the ones used; shared objects are snapshotted once,
with depth checked at every reference, and input objects are never passed to the
interpreter.

Other error codes are `INVALID_CONTEXT`, `NON_JSON_RESULT`, `INVALID_BOUNDS` and
`EVALUATION_FAILED`. In particular `NaN`, infinities and `undefined` results are
refused, including non-JSON members inside a result. Ordinary numeric computation
retains JSONLogic's binary floating-point semantics; `exactDecimals` is `false`.

`evaluateTruth` uses an internal unknown distinct from the JSON string
`'unknown'`. An absent variable without a default is unknown; an explicit `null`
is a known value. `and`, `or` and `!` obey Kleene logic. Known logical operands keep their
JSONLogic values inside enclosing expressions. A certain boolean classification
does not invent the value of an unresolved operand. `missing` and `missing_some`
evaluate dynamic arguments through this same logic and distinguish absence from
a present but unresolved intermediate value. Known `if` conditions
execute only the chosen branch. For an unknown condition, identical JSON branch
values become known; differing branches stay unknown. Numeric alternatives can
supply conservative intervals to a sum, so two true criteria and one unknown can
still establish a threshold of two. Unknown collections or predicates propagate
unknown through membership, quantifiers and transformations unless a known
predicate already decides a quantifier. Empty-list truth follows JSONLogic in
this new method; the legacy `evaluate` still uses its original `Boolean()`.

An absent `$outputs.x` may have `{ min, max }` in `$bounds.x` (either endpoint may
be omitted). Finite number endpoints or canonical decimal strings are accepted;
invalid, empty or reversed bounds are refused when read. The six comparisons
`<`, `<=`, `>`, `>=`, `==`, `!=` decide only if the whole interval gives the same
answer. Decimal ordering uses spec's `compareOutputValues`, never text ordering
or conversion to binary numbers. Strict equality on unknown values stays unknown.
Bounds are not substituted for a present output or a variable's explicit default,
and bounds on an output do not constrain a nested field of that output.

```ts
evaluator.evaluateTruth(
  { '>=': [{ var: '$outputs.criteres' }, 2] },
  { $bounds: { criteres: { min: 2, max: 3 } } },
); // { value: true, boundedReads: ['/$outputs/criteres'] }
```

`boundedReads` is present only for bounds used to decide the returned boolean,
with sorted, unique context pointers. It is absent for an unknown result and for
bounds discarded by a decisive `and`/`or` term. The standalone `TruthResult` and
`TruthValue` types are exported here; core integration is deferred to Task 12A.

### Unpublished spec dependency and local checks

This development branch directly requires `@run-iq/spec` `^1.0.0-next.1` for its
comparison API. **That version is not published yet.** The core peer range remains
unchanged. The locked spec `next.0` is retained only for old core's transitive
installation; it cannot provide the new evaluator's comparison API. The committed
development manifest therefore needs the branch substitution below until the new
spec is published. No fallback to the old spec is supported.

For PRs into `refonte/*`, CI follows core's pattern on both Node 20 and 24: require
the matching spec branch, check it out, build it, remove the unpublished direct
spec from the runner's install manifests only, install the remaining locked tree,
then replace old core's transitive spec with a link to the built branch. Phase-2
pushes and manual checks also use the spec branch. No repository manifest is
committed by these runner steps. A missing branch, failed build or absent export
fails CI.

Replay that setup locally in an isolated copy, using a read-only export of spec's
`origin/refonte/phase-2`. Do not edit the other lane's spec checkout. After the
linked installation, `npm run ci:local` runs typecheck (source and tests), lint,
formatting, all tests and build. Use the lockfile's formatter. This repository has
no heavy suite. Runtime publication and the new core integration belong to later
jobs.
