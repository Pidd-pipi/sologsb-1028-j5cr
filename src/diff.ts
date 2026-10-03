import type { ComponentSnapshot, ComponentSpec, DiffRow, EffectiveConclusion } from './types';

const selectedFields: Array<Exclude<keyof ComponentSpec, 'snapshots'>> = [
  'name', 'category', 'status', 'purpose', 'usage', 'states', 'keyboardBehavior', 'screenReader', 'disabledScenarios'
];

const format = (value: unknown): string => {
  if (Array.isArray(value)) return value.map((item) => JSON.stringify(item)).join('\n');
  return String(value ?? '');
};

export function diffAgainstSnapshot(component: ComponentSpec, snapshot?: ComponentSnapshot): DiffRow[] {
  if (!snapshot) return [];
  const rows: DiffRow[] = [];
  for (const field of selectedFields) {
    const before = format(snapshot.component[field]);
    const after = format(component[field]);
    if (before !== after) rows.push({ field: String(field), before, after });
  }
  const beforeProperties = format(snapshot.component.properties);
  const afterProperties = format(component.properties);
  if (beforeProperties !== afterProperties) rows.push({ field: 'properties', before: beforeProperties, after: afterProperties });
  const beforeExamples = format(snapshot.component.examples);
  const afterExamples = format(component.examples);
  if (beforeExamples !== afterExamples) rows.push({ field: 'examples', before: beforeExamples, after: afterExamples });
  return rows;
}

/** 版本差异只读取最终生效结论：当前草稿 vs 最近一次已确认的评审结论。 */
export function diffAgainstEffective(component: ComponentSpec, conclusion?: EffectiveConclusion): DiffRow[] {
  if (!conclusion) return [];
  return diffAgainstSnapshot(component, {
    revision: conclusion.revision,
    savedAt: conclusion.confirmedAt,
    reason: '最终生效结论',
    component: conclusion.content
  });
}
