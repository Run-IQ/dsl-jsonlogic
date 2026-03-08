import jsonLogic from 'json-logic-js';
import type { DSLEvaluator } from '@run-iq/core';
import { VERSION } from './version.js';

export class JsonLogicEvaluator implements DSLEvaluator {
  readonly dsl = 'jsonlogic' as const;
  readonly version = VERSION;

  evaluate(expression: unknown, context: Record<string, unknown>): boolean {
    return Boolean(jsonLogic.apply(expression, context));
  }
}
