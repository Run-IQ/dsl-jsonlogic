import jsonLogic from 'json-logic-js';
jsonLogic.rm_operation('log');
import type { DSLEvaluator } from '@run-iq/core';
import { VERSION } from './version.js';

export class JsonLogicEvaluator implements DSLEvaluator {
  readonly dsl = 'jsonlogic' as const;
  readonly version = VERSION;

  evaluate(expression: unknown, context: Record<string, unknown>): boolean {
    try {
      return Boolean(jsonLogic.apply(expression, context));
    } catch (error) {
      throw new Error(
        `JSONLogic evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
