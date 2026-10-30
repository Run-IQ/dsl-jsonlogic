# @run-iq/dsl-jsonlogic

Lets [Run-IQ](https://github.com/Run-IQ/core) rules use [JSONLogic](https://jsonlogic.com) expressions as conditions. A rule only applies when its condition is true for the input data.

[`@run-iq/core`](https://github.com/Run-IQ/core) does not evaluate conditions itself. It hands each `condition` to the evaluator registered for its `dsl` name, and this package is the evaluator for `'jsonlogic'`.

## Install

```bash
npm install @run-iq/dsl-jsonlogic @run-iq/core
```

`@run-iq/core` is a peer dependency. Requires Node.js 20 or later.

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
    value: { and: [{ '>=': [{ var: 'orderTotal' }, 100] }, { '==': [{ var: 'customer.tier' }, 'gold'] }] },
  },
  priority: 1,
  effectiveFrom: new Date('2025-01-01'),
  effectiveUntil: null,
  tags: [],
};
const rule = { ...draft, checksum: computeRuleChecksum(draft) };

const meta = { tenantId: 'acme', effectiveDate: new Date('2025-06-01') };

const gold = await engine.evaluate([rule], { requestId: 'a', data: { orderTotal: 120, customer: { tier: 'gold' } }, meta });
gold.value; // 5

const basic = await engine.evaluate([rule], { requestId: 'b', data: { orderTotal: 120, customer: { tier: 'basic' } }, meta });
basic.value;                   // 0
basic.skippedRules[0].reason;  // 'CONDITION_FALSE'
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
