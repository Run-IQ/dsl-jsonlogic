// NOTE: json-logic-js uses global mutable state for its operator registry.
// All instances of JsonLogicEvaluator share the same operator table.
// We disable the 'log' operator globally to prevent uncontrolled console output
// during expression evaluation.
import jsonLogic from 'json-logic-js';
jsonLogic.rm_operation('log');

import type { DSLEvaluator, DSLSyntaxDoc } from '@run-iq/core';
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

  describeSyntax(): DSLSyntaxDoc {
    return {
      description:
        'JSONLogic is a JSON-based rules engine. Conditions are JSON objects where keys are operators and values are arguments.',
      conditionFormat: '{ "dsl": "jsonlogic", "value": <expression> }',
      operators: [
        { name: '==', description: 'Equality', syntax: '{ "==": [a, b] }' },
        { name: '!=', description: 'Inequality', syntax: '{ "!=": [a, b] }' },
        { name: '>', description: 'Greater than', syntax: '{ ">": [a, b] }' },
        { name: '>=', description: 'Greater than or equal', syntax: '{ ">=": [a, b] }' },
        { name: '<', description: 'Less than', syntax: '{ "<": [a, b] }' },
        { name: '<=', description: 'Less than or equal', syntax: '{ "<=": [a, b] }' },
        { name: 'and', description: 'Logical AND', syntax: '{ "and": [cond1, cond2, ...] }' },
        { name: 'or', description: 'Logical OR', syntax: '{ "or": [cond1, cond2, ...] }' },
        { name: '!', description: 'Logical NOT', syntax: '{ "!": [cond] }' },
        {
          name: 'var',
          description: 'Access input variable (supports dot-notation)',
          syntax: '{ "var": "fieldName" }',
        },
        {
          name: 'in',
          description: 'Check membership in array',
          syntax: '{ "in": [value, array] }',
        },
        {
          name: 'if',
          description: 'Conditional (ternary)',
          syntax: '{ "if": [cond, then, else] }',
        },
      ],
      examples: [
        {
          description: 'Revenue >= 1,000,000',
          expression: { '>=': [{ var: 'revenue' }, 1000000] },
        },
        {
          description: 'Income > 500,000 AND country is TG',
          expression: {
            and: [{ '>': [{ var: 'income' }, 500000] }, { '==': [{ var: 'country' }, 'TG'] }],
          },
        },
        {
          description: 'Business type is in allowed list',
          expression: { in: [{ var: 'businessType' }, ['enterprise', 'sarl', 'sa']] },
        },
      ],
    };
  }

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
