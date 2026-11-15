/** JSON values accepted and returned by the standalone evaluator. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonLogicErrorCode =
  | 'INVALID_EXPRESSION'
  | 'INVALID_CONTEXT'
  | 'NON_JSON_RESULT'
  | 'INVALID_BOUNDS'
  | 'EVALUATION_FAILED';
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

/** Snapshot data properties only. Never execute accessors or keep caller-owned objects. */
export function copyJson(
  input: unknown,
  code: JsonLogicErrorCode,
  maxDepth = MAX_EXPRESSION_DEPTH,
): JsonValue {
  let failure: JsonLogicError | undefined;
  function fail(message: string): never {
    failure = new JsonLogicError(code, message);
    throw failure;
  }
  const active = new WeakSet<object>();
  const snapshots = new WeakMap<object, { value: JsonValue; height: number }>();
  const heights = new WeakMap<object, number>();
  const walk = (value: unknown, depth: number, path: string): JsonValue => {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null) fail(`${path || '/'} is not JSON`);
    if (depth >= maxDepth) fail(`JSON exceeds maximum depth of ${maxDepth} at ${path || '/'}`);
    if (active.has(value)) fail(`JSON cycle at ${path || '/'}`);
    const cached = snapshots.get(value);
    if (cached) {
      if (depth + cached.height > maxDepth)
        fail(`JSON exceeds maximum depth of ${maxDepth} at ${path || '/'}`);
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
    snapshots.set(value, { value: result, height });
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
export const pointerOf = (path: string): string =>
  '/' + path.split('.').map(escapeSegment).join('/');
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
  '>': [2, 2],
  '>=': [2, 2],
  '<': [2, 3],
  '<=': [2, 3],
  '!': [1, 1],
  '!!': [1, 1],
  in: [2, 2],
  if: [2, Infinity],
  '?:': [2, Infinity],
  and: [0, Infinity],
  or: [0, Infinity],
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
  if (typeof path === 'string') return path;
  if (typeof path === 'number' && Number.isSafeInteger(path) && path >= 0) return String(path);
  throw new JsonLogicError(
    'INVALID_EXPRESSION',
    'var path must be a string or a non-negative safe integer',
  );
}
export function prepareExpression(input: unknown): JsonValue {
  const expression = copyJson(input, 'INVALID_EXPRESSION');
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
  return [...found].sort();
}
export function prepareContext(input: unknown): JsonValue {
  const context = copyJson(input, 'INVALID_CONTEXT');
  if (context === null || typeof context !== 'object' || Array.isArray(context))
    throw new JsonLogicError('INVALID_CONTEXT', 'Context must be a JSON object');
  return context;
}
