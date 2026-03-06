import jsonLogic from 'json-logic-js';
import type { DSLEvaluator } from '@run-iq/core';

export class JsonLogicEvaluator implements DSLEvaluator {
  readonly dsl = 'jsonlogic' as const;
  readonly version = '1.0.0';

  evaluate(expression: unknown, context: Record<string, unknown>): boolean {
    return Boolean(jsonLogic.apply(expression, context));
  }
}
