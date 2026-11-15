import { comparePointers, formatPointer } from '@run-iq/spec/canonical';
/** JSON values accepted and returned by the standalone evaluator. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonLogicErrorCode =
  | 'INVALID_EXPRESSION'
  | 'INVALID_CONTEXT'
  | 'NON_JSON_RESULT'
  | 'INVALID_BOUNDS'
  | 'EVALUATION_FAILED'
  | 'INCOMPARABLE'
  | 'MISSING_FACT'
  | 'LIMIT_EXCEEDED';
export class JsonLogicError extends Error {
  readonly name = 'JsonLogicError';
  constructor(
    readonly code: JsonLogicErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export const MAX_EXPRESSION_DEPTH = 50;
export const MAX_EXPRESSION_NODES = 100_000;
export const MAX_EVALUATION_STEPS = 100_000;
export const MAX_VALUE_NODES = 100_000;

/** Snapshot data properties only. Never execute accessors or keep caller-owned objects. */
export function copyJson(
  input: unknown,
  code: JsonLogicErrorCode,
  maxDepth = MAX_EXPRESSION_DEPTH,
  maxNodes = MAX_VALUE_NODES,
  spend?: (amount: number) => void,
): JsonValue {
  let remaining = maxNodes;
  let failure: JsonLogicError | undefined;
  function fail(message: string): never {
    failure = new JsonLogicError(code, message);
    throw failure;
  }
  function failBudget(): never {
    failure = new JsonLogicError('LIMIT_EXCEEDED', 'Maximum evaluation steps exceeded');
    throw failure;
  }
  const active = new WeakSet<object>();
  const snapshots = new WeakMap<object, { value: JsonValue; height: number; size: number }>();
  const sizes = new WeakMap<object, number>();
  const heights = new WeakMap<object, number>();
  const walk = (value: unknown, depth: number, path: string): JsonValue => {
    if (spend) {
      try {
        spend(typeof value === 'string' ? 1 + value.length : 1);
      } catch {
        failBudget();
      }
    }
    if (--remaining < 0) {
      failure = new JsonLogicError('LIMIT_EXCEEDED', `JSON exceeds maximum nodes of ${maxNodes}`);
      throw failure;
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null) fail(`${path || '/'} is not JSON`);
    if (depth >= maxDepth) fail(`JSON exceeds maximum depth of ${maxDepth} at ${path || '/'}`);
    if (active.has(value)) fail(`JSON cycle at ${path || '/'}`);
    const cached = snapshots.get(value);
    if (cached) {
      if (depth + cached.height > maxDepth)
        fail(`JSON exceeds maximum depth of ${maxDepth} at ${path || '/'}`);
      if (spend) {
        try {
          spend(cached.size - 1);
        } catch {
          failBudget();
        }
      }
      remaining -= cached.size - 1;
      if (remaining < 0) {
        failure = new JsonLogicError('LIMIT_EXCEEDED', `JSON exceeds maximum nodes of ${maxNodes}`);
        throw failure;
      }
      return cached.value;
    }
    const array = Array.isArray(value);
    const proto: unknown = Object.getPrototypeOf(value);
    if (!array && proto !== Object.prototype && proto !== null)
      fail(`Non-plain object at ${path || '/'}`);
    active.add(value);
    // Object descriptors are read once, then both validation and evaluation use the copy.
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const result: JsonValue[] | { [key: string]: JsonValue } = array
      ? []
      : (Object.create(null) as { [key: string]: JsonValue });
    const length = array ? (descriptors.length?.value as unknown) : undefined;
    if (array && (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0))
      fail(`Invalid array at ${path || '/'}`);
    let entries = 0;
    let height = 1;
    let size = 1;
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') fail(`Symbol key at ${path || '/'}`);
      const descriptor = descriptors[key]!;
      const at = `${path}/${escapeSegment(key)}`;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        fail(`Non-data property at ${at}`);
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= Number(length)))
        fail(`Invalid array key at ${at}`);
      const child = walk(descriptor.value, depth + 1, at);
      if (child !== null && typeof child === 'object')
        height = Math.max(height, 1 + heights.get(child)!);
      size += child !== null && typeof child === 'object' ? sizes.get(child)! : 1;
      Object.defineProperty(result, key, {
        value: child,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      entries++;
    }
    if (array && entries !== length) fail(`Sparse array at ${path || '/'}`);
    active.delete(value);
    heights.set(result, height);
    sizes.set(result, size);
    snapshots.set(value, { value: result, height, size });
    return result;
  };
  try {
    return walk(input, 0, '');
  } catch (error) {
    if (failure !== undefined && error === failure) throw failure;
    throw new JsonLogicError(code, 'JSON could not be inspected');
  }
}
export const escapeSegment = (segment: string): string =>
  segment.replace(/~/g, '~0').replace(/\//g, '~1');
export function pointerOf(path: string): string {
  const segments = path.split('.');
  if (segments.includes('-'))
    throw new JsonLogicError('INVALID_EXPRESSION', 'A read cannot contain a - segment');
  try {
    return formatPointer(segments);
  } catch {
    throw new JsonLogicError('INVALID_EXPRESSION', 'Invalid read pointer');
  }
}
export function operation(expression: JsonValue): { op: string; args: JsonValue[] } | undefined {
  if (expression === null || typeof expression !== 'object' || Array.isArray(expression))
    return undefined;
  const keys = Object.keys(expression);
  if (keys.length !== 1) return undefined;
  const op = keys[0]!;
  const value = expression[op]!;
  return { op, args: Array.isArray(value) ? value : [value] };
}
export const SCOPED = new Set(['some', 'all', 'none', 'map', 'filter', 'reduce']);
const arities: Record<string, readonly [number, number]> = {
  var: [0, 2],
  '==': [2, 2],
  '!=': [2, 2],
  '===': [2, 2],
  '!==': [2, 2],
  between: [3, 3],
  '>': [2, 2],
  '>=': [2, 2],
  '<': [2, 3],
  '<=': [2, 3],
  '!': [1, 1],
  '!!': [1, 1],
  in: [2, 2],
  if: [2, Infinity],
  '?:': [2, Infinity],
  and: [1, Infinity],
  or: [1, Infinity],
  '+': [0, Infinity],
  '*': [1, Infinity],
  '-': [1, 2],
  '/': [2, 2],
  '%': [2, 2],
  min: [1, Infinity],
  max: [1, Infinity],
  cat: [0, Infinity],
  substr: [2, 3],
  merge: [0, Infinity],
  missing: [0, Infinity],
  missing_some: [2, 2],
  some: [2, 2],
  all: [2, 2],
  none: [2, 2],
  map: [2, 2],
  filter: [2, 2],
  reduce: [2, 3],
};
export function varPath(args: JsonValue[]): string {
  if (!args.length) return '';
  const path = args[0];
  if (typeof path === 'string') {
    if (path !== '') pointerOf(path);
    return path;
  }
  if (typeof path === 'number' && Number.isSafeInteger(path) && path >= 0) return String(path);
  throw new JsonLogicError(
    'INVALID_EXPRESSION',
    'var path must be a string or a non-negative safe integer',
  );
}
export function prepareExpression(input: unknown): JsonValue {
  const expression = copyJson(
    input,
    'INVALID_EXPRESSION',
    MAX_EXPRESSION_DEPTH,
    MAX_EXPRESSION_NODES,
  );
  const visit = (value: JsonValue): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const entry = operation(value);
    if (!entry) return;
    const { op, args } = entry;
    const arity = Object.hasOwn(arities, op) ? arities[op] : undefined;
    if (!arity) throw new JsonLogicError('INVALID_EXPRESSION', `Unknown JSONLogic operator: ${op}`);
    if (args.length < arity[0] || args.length > arity[1])
      throw new JsonLogicError('INVALID_EXPRESSION', `Invalid arguments for ${op}`);
    if (op === 'var') {
      varPath(args);
      if (args.length === 2) visit(args[1]!);
    } else args.forEach(visit);
  };
  visit(expression);
  return expression;
}
export function requiredVariables(expression: JsonValue): string[] {
  const found = new Set<string>();
  const visit = (value: JsonValue, scoped: boolean): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, scoped));
      return;
    }
    const entry = operation(value);
    if (!entry) return;
    const { op, args } = entry;
    if (op === 'var') {
      const path = varPath(args);
      if (!scoped && path !== '' && args.length < 2) found.add(pointerOf(path));
      if (args.length === 2) visit(args[1]!, scoped);
    } else args.forEach((arg, i) => visit(arg, scoped || (SCOPED.has(op) && i === 1)));
  };
  visit(expression, false);
  return [...found].sort(comparePointers);
}
export function prepareContext(input: unknown): JsonValue {
  const context = copyJson(input, 'INVALID_CONTEXT');
  if (context === null || typeof context !== 'object' || Array.isArray(context))
    throw new JsonLogicError('INVALID_CONTEXT', 'Context must be a JSON object');
  return context;
}
