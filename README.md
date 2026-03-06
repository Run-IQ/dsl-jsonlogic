# @run-iq/dsl-jsonlogic

[JSONLogic](https://jsonlogic.com) DSL evaluator for the PPE engine.

## Install

```bash
npm install @run-iq/dsl-jsonlogic
```

**Peer dependency:** `@run-iq/core >= 0.1.0`

## Usage

```typescript
import { PPEEngine } from '@run-iq/core';
import { JsonLogicEvaluator } from '@run-iq/dsl-jsonlogic';

const engine = new PPEEngine({
  plugins: [myPlugin],
  dsls: [new JsonLogicEvaluator()],
  strict: true,
});
```

Rules can then use `jsonlogic` conditions:

```typescript
const rule = {
  id: 'tax-high-income',
  model: 'PROGRESSIVE_BRACKET',
  condition: {
    dsl: 'jsonlogic',
    value: { '>': [{ var: 'grossSalary' }, 5_000_000] },
  },
  // ...
};
```

## API

### `JsonLogicEvaluator`

Implements `DSLEvaluator` from `@run-iq/core`.

| Property | Value |
|---|---|
| `dsl` | `"jsonlogic"` |
| `version` | `"1.0.0"` |

**`evaluate(expression, context)`** — evaluates a JSONLogic expression against a data context and returns a boolean.

Timeout and sandboxing are handled by the core engine's `PluginSandbox` — this evaluator stays pure.

## Requirements

- Node.js >= 20
- `@run-iq/core` >= 0.1.0

## License

MIT
