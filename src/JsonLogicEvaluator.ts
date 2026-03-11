// NOTE: json-logic-js uses global mutable state for its operator registry.
// All instances of JsonLogicEvaluator share the same operator table.
// We disable the 'log' operator globally to prevent uncontrolled console output
// during expression evaluation.
import jsonLogic from 'json-logic-js';
jsonLogic.rm_operation('log');

import type { DSLEvaluator } from '@run-iq/core';
import { VERSION } from './version.js';

const MAX_EXPRESSION_DEPTH = 50;

/**
 * Recursively compute the depth of a JSONLogic expression tree.
 * Primitive values have depth 0. Objects and arrays add one level.
 */
export function getDepth(expr: unknown): number {
  if (expr === null || expr === undefined) {
    return 0;
  }
  if (Array.isArray(expr)) {
    let max = 0;
    for (const item of expr) {
      const d = getDepth(item);
      if (d > max) max = d;
    }
    return 1 + max;
  }
  if (typeof expr === 'object') {
    let max = 0;
    // justification: typeof expr === 'object' && !Array.isArray(expr) && expr !== null guarantees this is a plain object
    const obj = expr as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const d = getDepth(obj[key]);
      if (d > max) max = d;
    }
    return 1 + max;
  }
  return 0;
}

export class JsonLogicEvaluator implements DSLEvaluator {
  readonly dsl = 'jsonlogic' as const;
  readonly version = VERSION;

  evaluate(expression: unknown, context: Record<string, unknown>): boolean {
    const depth = getDepth(expression);
    if (depth > MAX_EXPRESSION_DEPTH) {
      throw new Error(
        `JSONLogic expression exceeds maximum depth of ${String(MAX_EXPRESSION_DEPTH)} (got ${String(depth)})`,
      );
    }

    try {
      return Boolean(jsonLogic.apply(expression, context));
    } catch (error) {
      throw new Error(
        `JSONLogic evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
