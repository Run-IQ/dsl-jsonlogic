import jsonLogic from 'json-logic-js';
import {
  compareOutputValues,
  isCanonicalDecimal,
  toCanonicalDecimal,
} from '@run-iq/spec/canonical';
import { copyJson, JsonLogicError, operation, pointerOf, varPath } from './expression.js';
import type { JsonValue } from './expression.js';

export type TruthValue = boolean | 'unknown';
/** Standalone result; core integration follows in Task 12A. */
export interface TruthResult {
  value: TruthValue;
  boundedReads?: string[];
}
const UNKNOWN = Symbol('unknown');
type Endpoint = number | string;
interface Interval {
  min?: Endpoint;
  max?: Endpoint;
}
interface Result {
  value: JsonValue | typeof UNKNOWN;
  reads: string[];
  interval?: Interval;
  truth?: boolean;
  truthReads?: string[];
  absent?: true;
}
interface Scope {
  data: JsonValue;
  root: boolean;
  locals?: Record<string, Result>;
}
const known = (value: JsonValue, reads: string[] = []): Result => ({ value, reads });
const unknown = (interval?: Interval, reads: string[] = []): Result =>
  interval === undefined ? { value: UNKNOWN, reads } : { value: UNKNOWN, interval, reads };
const readsOf = (results: Result[]): string[] =>
  [...new Set(results.flatMap((r) => r.reads))].sort();
const truthy = (value: JsonValue): boolean =>
  Array.isArray(value) && value.length === 0 ? false : Boolean(value);
const truthOf = (result: Result): boolean | undefined =>
  result.value === UNKNOWN ? result.truth : truthy(result.value);
const truthReadsOf = (result: Result): string[] => result.truthReads ?? result.reads;
const withEvidence = (result: Result, dependencies: string[]): Result => ({
  ...result,
  reads: [...new Set([...result.reads, ...dependencies])].sort(),
  truthReads: [...new Set([...truthReadsOf(result), ...dependencies])].sort(),
});
const sameJson = (a: JsonValue, b: JsonValue): boolean => {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        sameJson((a as Record<string, JsonValue>)[key]!, (b as Record<string, JsonValue>)[key]!),
    )
  );
};

/** Expand the decimal spelling of a binary number; all ordering is delegated to spec. */
function decimal(value: Endpoint): string {
  if (typeof value === 'string') return value;
  const [mantissa = '', power] = String(value).split('e');
  if (power === undefined) return toCanonicalDecimal(mantissa);
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [integer = '', fraction = ''] = unsigned.split('.');
  const digits = integer + fraction;
  const point = integer.length + Number(power);
  const expanded =
    point <= 0
      ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : digits.slice(0, point) + '.' + digits.slice(point);
  return toCanonicalDecimal((negative ? '-' : '') + expanded);
}
function compare(a: Endpoint, b: Endpoint): number {
  return typeof a === 'number' && typeof b === 'number'
    ? compareOutputValues(a, b, { type: 'number', combine: 'max' })
    : compareOutputValues(decimal(a), decimal(b), { type: 'decimal', combine: 'max' });
}
function intervalOf(result: Result): Interval | undefined {
  if (result.value === UNKNOWN) return result.interval;
  const v = result.value;
  return typeof v === 'number' || (typeof v === 'string' && isCanonicalDecimal(v))
    ? { min: v, max: v }
    : undefined;
}
function boundsFor(path: string, data: JsonValue): Result {
  const parts = path.split('.');
  if (parts.length !== 2 || parts[0] !== '$outputs' || data === null || typeof data !== 'object')
    return unknown();
  const root = data as Record<string, JsonValue>;
  if (!Object.hasOwn(root, '$bounds')) return unknown();
  const bounds = root.$bounds;
  if (bounds === null || Array.isArray(bounds) || typeof bounds !== 'object')
    throw new JsonLogicError('INVALID_BOUNDS', '$bounds must be an object');
  if (!Object.hasOwn(bounds, parts[1]!)) return unknown();
  const entry = bounds[parts[1]!]!;
  if (entry === null || Array.isArray(entry) || typeof entry !== 'object')
    throw new JsonLogicError('INVALID_BOUNDS', `Invalid bounds for ${path}`);
  const keys = Object.keys(entry);
  if (!keys.length || keys.some((k) => k !== 'min' && k !== 'max'))
    throw new JsonLogicError('INVALID_BOUNDS', `Invalid bounds fields for ${path}`);
  const interval: Interval = {};
  for (const key of keys as ('min' | 'max')[]) {
    const value = entry[key];
    if (typeof value !== 'number' && !(typeof value === 'string' && isCanonicalDecimal(value)))
      throw new JsonLogicError('INVALID_BOUNDS', `Invalid ${key} for ${path}`);
    interval[key] = value;
  }
  if (
    interval.min !== undefined &&
    interval.max !== undefined &&
    compare(interval.min, interval.max) > 0
  )
    throw new JsonLogicError('INVALID_BOUNDS', `Reversed bounds for ${path}`);
  return unknown(interval, [pointerOf(path)]);
}
function boundedComparison(op: string, a: Result, b: Result): Result {
  const x = intervalOf(a),
    y = intervalOf(b);
  if (!x || !y) return unknown();
  const { min: lo, max: hi } = x,
    { min: otherLo, max: otherHi } = y;
  const evidence = readsOf([a, b]);
  if (op === '<' || op === '<=') return boundedComparison(op === '<' ? '>' : '>=', b, a);
  if (op === '>' || op === '>=') {
    if (
      lo !== undefined &&
      otherHi !== undefined &&
      (op === '>' ? compare(lo, otherHi) > 0 : compare(lo, otherHi) >= 0)
    )
      return known(true, evidence);
    if (
      hi !== undefined &&
      otherLo !== undefined &&
      (op === '>' ? compare(hi, otherLo) <= 0 : compare(hi, otherLo) < 0)
    )
      return known(false, evidence);
    return unknown();
  }
  if (op === '==' || op === '!=') {
    const equal =
      lo !== undefined &&
      hi !== undefined &&
      otherLo !== undefined &&
      otherHi !== undefined &&
      compare(lo, hi) === 0 &&
      compare(otherLo, otherHi) === 0 &&
      compare(lo, otherLo) === 0;
    const disjoint =
      (hi !== undefined && otherLo !== undefined && compare(hi, otherLo) < 0) ||
      (lo !== undefined && otherHi !== undefined && compare(lo, otherHi) > 0);
    if (equal || disjoint) return known(op === '!=' ? !equal : equal, evidence);
  }
  return unknown();
}
function native(op: string, results: Result[]): Result {
  if (results.some((r) => r.value === UNKNOWN)) return unknown();
  const values = results.map((r) => r.value);
  // A var wrapper hands the library already computed values without reinterpreting data as logic.
  const expression = { [op]: values.map((_, i) => ({ var: String(i) })) };
  let result: unknown;
  try {
    result = jsonLogic.apply(expression, values);
  } catch {
    throw new JsonLogicError('EVALUATION_FAILED', `JSONLogic ${op} failed`);
  }
  return known(copyJson(result, 'NON_JSON_RESULT'), readsOf(results));
}
function conjunction(results: Result[], isAnd: boolean): Result {
  const decisive = results.find((r) => r.value !== UNKNOWN && truthy(r.value) === !isAnd);
  if (decisive) return known(!isAnd, decisive.reads);
  return results.some((r) => r.value === UNKNOWN) ? unknown() : known(isAnd, readsOf(results));
}
export function truthResult(expression: JsonValue, context: JsonValue): TruthResult {
  const root: Scope = { data: context, root: true };
  // Presence is distinct from an existing intermediate value that is still unknown.
  const resolve = (path: string, scope: Scope): Result => {
    if (path === '') {
      if (!scope.locals) return known(scope.data);
      const members = Object.entries(scope.locals);
      if (members.some(([, value]) => value.value === UNKNOWN))
        return { ...unknown(), truth: true };
      return known(
        Object.fromEntries(members.map(([key, value]) => [key, value.value as JsonValue])),
        readsOf(members.map(([, value]) => value)),
      );
    }
    const segments = path.split('.');
    let local =
      scope.locals && Object.hasOwn(scope.locals, segments[0]!)
        ? scope.locals[segments[0]!]
        : undefined;
    let current: JsonValue | typeof UNKNOWN = local ? local.value : scope.data;
    const evidence = local?.reads ?? [];
    for (let i = local ? 1 : 0; i < segments.length; i++) {
      if (current === UNKNOWN) return unknown();
      if (
        current === null ||
        (typeof current !== 'object' && typeof current !== 'string') ||
        !Object.hasOwn(Object(current), segments[i]!)
      )
        return { ...unknown(undefined, evidence), absent: true };
      current = Reflect.get(Object(current), segments[i]!) as JsonValue;
      local = undefined;
    }
    return local ?? known(current as JsonValue, evidence);
  };
  const evaluate = (expr: JsonValue, scope: Scope): Result => {
    if (Array.isArray(expr)) {
      const items = expr.map((item) => evaluate(item, scope));
      return items.some((item) => item.value === UNKNOWN)
        ? unknown()
        : known(
            items.map((item) => item.value as JsonValue),
            readsOf(items),
          );
    }
    const entry = operation(expr);
    if (!entry) return known(expr);
    const { op, args } = entry;
    if (op === 'var') {
      const path = varPath(args);
      const result = resolve(path, scope);
      if (!result.absent) return result;
      if (args.length === 2) return withEvidence(evaluate(args[1]!, scope), result.reads);
      return withEvidence(scope.root ? boundsFor(path, context) : unknown(), result.reads);
    }
    if (op === 'and' || op === 'or') {
      const terms: Result[] = [];
      for (const arg of args) {
        const term = evaluate(arg, scope);
        terms.push(term);
        if (truthOf(term) === (op === 'or')) {
          if (terms.every((r) => r.value !== UNKNOWN))
            return { ...term, reads: readsOf(terms), truthReads: truthReadsOf(term) };
          return {
            ...unknown(undefined, readsOf(terms)),
            truth: op === 'or',
            truthReads: truthReadsOf(term),
          };
        }
      }
      if (terms.some((r) => truthOf(r) === undefined)) return unknown();
      if (terms.some((r) => r.value === UNKNOWN))
        return {
          ...unknown(undefined, readsOf(terms)),
          truth: op === 'and',
          truthReads: [...new Set(terms.flatMap(truthReadsOf))].sort(),
        };
      return terms.length
        ? {
            ...terms[terms.length - 1]!,
            reads: readsOf(terms),
            truthReads: [...new Set(terms.flatMap(truthReadsOf))].sort(),
          }
        : known(op === 'and');
    }
    if (op === '!' || op === '!!') {
      const result = evaluate(args[0]!, scope),
        value = truthOf(result);
      return value === undefined
        ? unknown()
        : known(op === '!' ? !value : value, truthReadsOf(result));
    }
    if (op === 'if' || op === '?:') {
      // Flat else-if chains add no expression depth. Keep their frames off the JS stack.
      const frames: { condition: Result; yes?: Result }[] = [];
      let selected = known(null);
      for (let index = 0; index < args.length; index += 2) {
        if (index === args.length - 1) {
          selected = evaluate(args[index]!, scope);
          break;
        }
        const condition = evaluate(args[index]!, scope);
        if (truthOf(condition) === true) {
          const branch = evaluate(args[index + 1]!, scope);
          selected = withEvidence(branch, truthReadsOf(condition));
          break;
        }
        frames.push(
          truthOf(condition) === undefined
            ? { condition, yes: evaluate(args[index + 1]!, scope) }
            : { condition },
        );
      }
      for (let index = frames.length - 1; index >= 0; index--) {
        const { condition, yes } = frames[index]!;
        if (yes === undefined) {
          selected = withEvidence(selected, truthReadsOf(condition));
          continue;
        }
        const no = selected;
        if (yes.value !== UNKNOWN && no.value !== UNKNOWN && sameJson(yes.value, no.value)) {
          selected = known(yes.value, readsOf([yes, no]));
          continue;
        }
        const a = intervalOf(yes),
          b = intervalOf(no);
        selected =
          typeof a?.min === 'number' &&
          typeof a.max === 'number' &&
          typeof b?.min === 'number' &&
          typeof b.max === 'number'
            ? unknown(
                {
                  min: compare(a.min, b.min) <= 0 ? a.min : b.min,
                  max: compare(a.max, b.max) >= 0 ? a.max : b.max,
                },
                readsOf([yes, no]),
              )
            : unknown();
      }
      return selected;
    }
    if (['some', 'all', 'none', 'map', 'filter', 'reduce'].includes(op)) {
      const source = evaluate(args[0]!, scope);
      if (source.value === UNKNOWN) return unknown();
      if (op === 'reduce') {
        let accumulator = args.length > 2 ? evaluate(args[2]!, scope) : known(null);
        if (!Array.isArray(source.value)) return withEvidence(accumulator, source.reads);
        for (const item of source.value)
          accumulator = evaluate(args[1]!, {
            data: null,
            root: false,
            locals: { current: known(item), accumulator },
          });
        return withEvidence(accumulator, source.reads);
      }
      const items = Array.isArray(source.value) ? source.value : [];
      const results: Result[] = [];
      const mapped: JsonValue[] = [];
      for (const item of items) {
        const result = evaluate(args[1]!, { data: item, root: false });
        results.push(result);
        if (op === 'map' && result.value !== UNKNOWN) mapped.push(result.value);
        if (op === 'filter' && truthOf(result) === true) mapped.push(item);
        if (
          truthOf(result) !== undefined &&
          (((op === 'some' || op === 'none') && truthOf(result) === true) ||
            (op === 'all' && truthOf(result) === false))
        )
          return known(op === 'some', readsOf([source, result]));
      }
      if (results.some((r) => (op === 'map' ? r.value === UNKNOWN : truthOf(r) === undefined)))
        return unknown();
      if (op === 'map' || op === 'filter') return known(mapped, readsOf([source, ...results]));
      return known(
        op === 'none' || (op === 'all' && items.length > 0),
        readsOf([source, ...results]),
      );
    }
    if (op === 'missing' || op === 'missing_some') {
      const arguments_ = args.map((arg) => evaluate(arg, scope));
      if (arguments_.some((r) => r.value === UNKNOWN)) return unknown();
      const values = arguments_.map((r) => r.value as JsonValue);
      const rawKeys =
        op === 'missing_some' ? values[1] : Array.isArray(values[0]) ? values[0] : values;
      if (!Array.isArray(rawKeys))
        throw new JsonLogicError('EVALUATION_FAILED', `${op} requires a list of paths`);
      const missing: JsonValue[] = [];
      const inspected: Result[] = [];
      let present = 0,
        uncertain = 0;
      for (const key of rawKeys) {
        if (
          typeof key !== 'string' &&
          !(typeof key === 'number' && Number.isSafeInteger(key) && key >= 0)
        )
          throw new JsonLogicError('EVALUATION_FAILED', `${op} requires string or integer paths`);
        const result = resolve(String(key), scope);
        inspected.push(result);
        if (result.absent || result.value === null || result.value === '') missing.push(key);
        else if (result.value === UNKNOWN) uncertain++;
        else present++;
      }
      const evidence = readsOf([...arguments_, ...inspected]);
      if (op === 'missing_some') {
        const need = known(values[0]!);
        if (native('>=', [known(present), need]).value === true) return known([], evidence);
        if (native('>=', [known(present + uncertain), need]).value === true && uncertain)
          return unknown();
      }
      if (!uncertain) return known(missing, evidence);
      return missing.length ? { ...unknown(undefined, evidence), truth: true } : unknown();
    }
    const results = args.map((arg) => evaluate(arg, scope));
    if (
      ['<', '<=', '>', '>=', '==', '!='].includes(op) &&
      results.some((r) => r.value === UNKNOWN)
    ) {
      const comparisons: Result[] = [];
      for (let i = 0; i < results.length - 1; i++) {
        const pair = [results[i]!, results[i + 1]!];
        comparisons.push(
          pair.every((r) => r.value !== UNKNOWN)
            ? native(op, pair)
            : boundedComparison(op, pair[0]!, pair[1]!),
        );
      }
      return conjunction(comparisons, true);
    }
    if (op === '+' && results.some((r) => r.value === UNKNOWN)) {
      const ranges = results.map(intervalOf);
      if (
        ranges.every(
          (r): r is { min: number; max: number } =>
            typeof r?.min === 'number' && typeof r.max === 'number',
        )
      ) {
        const min = ranges.reduce((sum, r) => sum + r.min, 0),
          max = ranges.reduce((sum, r) => sum + r.max, 0);
        if (!Number.isFinite(min) || !Number.isFinite(max))
          throw new JsonLogicError('NON_JSON_RESULT', 'Non-finite interval arithmetic');
        return unknown({ min, max }, readsOf(results));
      }
    }
    return native(op, results);
  };
  const result = evaluate(expression, root);
  const value = truthOf(result);
  if (value === undefined) return { value: 'unknown' };
  const evidence = truthReadsOf(result);
  return evidence.length ? { value, boundedReads: [...new Set(evidence)].sort() } : { value };
}
