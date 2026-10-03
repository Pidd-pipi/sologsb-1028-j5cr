import type { ComponentSnapshot, ComponentSpec, DiffRow, FrozenSpec } from './types';

const selectedFields: Array<Exclude<keyof ComponentSpec, 'snapshots' | 'submitFailures'>> = [
  'name', 'category', 'status', 'purpose', 'usage', 'states', 'keyboardBehavior', 'screenReader', 'disabledScenarios'
];

const format = (value: unknown): string => {
  if (Array.isArray(value)) return value.map((item) => JSON.stringify(item)).join('\n');
  return String(value ?? '');
};

/** 通用字段级差异：用于本地草稿快照比较。 */
export function diffAgainstSnapshot(component: ComponentSpec, snapshot?: ComponentSnapshot): DiffRow[] {
  if (!snapshot) return [];
  return diffSpecs(snapshot.component, component);
}

/**
 * 比较两份契约（任意顺序由调用方决定 before/after）。
 * 发布版本差异只允许传入「最终生效结论」作为 before。
 */
export function diffSpecs(beforeSpec: FrozenSpec, afterSpec: FrozenSpec): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const field of selectedFields) {
    const before = format(beforeSpec[field]);
    const after = format(afterSpec[field]);
    if (before !== after) rows.push({ field: String(field), before, after });
  }
  for (const field of ['properties', 'examples'] as const) {
    const before = format(beforeSpec[field]);
    const after = format(afterSpec[field]);
    if (before !== after) rows.push({ field, before, after });
  }
  return rows;
}
