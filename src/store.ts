import { createInitialState } from './data';
import type {
  ComponentSnapshot,
  ComponentSpec,
  EffectiveConclusion,
  SubmitResult,
  ValidationIssue,
  WorkspaceState
} from './types';

const STORAGE_KEY = 'sologsb-1028-workspace-v2';

/** 每个发布窗口的评审容量。 */
export const REVIEW_CAPACITY = 3;

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const signature = (component: ComponentSpec) => `${component.properties.map((item) => `${item.name}:${item.required}`).join('|')}::${component.interactionSignature}`;

/** 由队列中已确认项推导各组件的最终生效结论（每个组件取最近一次确认）。 */
const effectiveConclusionsFrom = (state: WorkspaceState): EffectiveConclusion[] => {
  const latest = new Map<string, WorkspaceState['reviewQueue'][number]>();
  for (const item of state.reviewQueue) {
    if (item.status !== 'confirmed') continue;
    const previous = latest.get(item.componentId);
    if (!previous || (item.resolvedAt ?? '') >= (previous.resolvedAt ?? '')) latest.set(item.componentId, item);
  }
  return [...latest.values()].map((item) => ({
    componentId: item.componentId,
    componentName: item.componentName,
    revision: item.revision,
    queueItemId: item.id,
    confirmedAt: item.resolvedAt ?? '',
    content: clone(item.content)
  }));
};

export class SpecStore extends EventTarget {
  state: WorkspaceState;
  private undoStack: WorkspaceState[] = [];
  private redoStack: WorkspaceState[] = [];
  private lastAction = '';

  constructor() {
    super();
    this.state = this.load();
  }

  get selected(): ComponentSpec | undefined {
    return this.state.components.find((item) => item.id === this.state.selectedId);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get lastUndoLabel() { return this.lastAction; }

  select(id: string) {
    if (!this.state.components.some((item) => item.id === id)) return;
    this.state = { ...this.state, selectedId: id };
    this.persist(false);
    this.emit();
  }

  addComponent() {
    const id = uid('component');
    const component: ComponentSpec = {
      id,
      name: 'Untitled component',
      category: 'Uncategorised',
      status: 'draft',
      purpose: '说明该组件解决的用户问题。',
      usage: '说明何时使用、何时不要使用。',
      properties: [],
      states: 'default、hover、focus-visible、disabled。',
      keyboardBehavior: '记录 Tab、Enter、Space、方向键和 Esc 等行为。',
      screenReader: '记录角色、名称、状态和动态播报。',
      disabledScenarios: '记录不应使用该组件的场景。',
      interactionSignature: '',
      examples: [],
      revision: 1,
      updatedAt: new Date().toISOString(),
      snapshots: []
    };
    this.commit('新建组件', (state) => {
      state.components.unshift(component);
      state.selectedId = id;
    });
  }

  updateComponent(patch: Partial<ComponentSpec>, markExamplesStale = false) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑组件', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      Object.assign(target, patch, { updatedAt: new Date().toISOString() });
      if (markExamplesStale) {
        target.examples.forEach((example) => {
          example.stale = true;
          example.staleReason = '组件交互或属性契约已修改，示例需要重新验证。';
        });
      }
      this.withdrawQueuedFor(state, selected.id);
    });
  }

  addProperty() {
    const selected = this.selected;
    if (!selected) return;
    this.commit('新增属性', (state) => {
      state.components.find((item) => item.id === selected.id)?.properties.push({
        id: uid('property'),
        name: 'newProperty',
        type: 'string',
        required: false,
        defaultValue: '',
        description: '描述该属性对开发者和用户的影响。'
      });
      this.withdrawQueuedFor(state, selected.id);
    });
  }

  updateProperty(propertyId: string, patch: Partial<ComponentSpec['properties'][number]>) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (target && property) Object.assign(property, patch);
      this.withdrawQueuedFor(state, selected.id);
    });
  }

  removeProperty(propertyId: string) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('删除属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      target.properties = target.properties.filter((item) => item.id !== propertyId);
      target.examples.forEach((example) => {
        if (example.propertyIds.includes(propertyId) || example.code.includes(property.name)) {
          example.stale = true;
          example.staleReason = `属性 ${property.name} 已删除，示例代码或说明仍可能引用它。`;
        }
      });
      this.withdrawQueuedFor(state, selected.id);
    });
  }

  addExample() {
    const selected = this.selected;
    if (!selected) return;
    const exampleId = uid('example');
    this.commit('新增示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      target.examples.push({
        id: exampleId,
        title: '新示例',
        code: `<${target.name.toLowerCase().replaceAll(' ', '-')}>示例</${target.name.toLowerCase().replaceAll(' ', '-')}>`,
        propertyIds: [],
        stale: false,
        staleReason: '',
        createdFromRevision: target.revision
      });
      this.withdrawQueuedFor(state, selected.id);
    });
  }

  updateExample(exampleId: string, patch: Partial<ComponentSpec['examples'][number]>) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const example = target?.examples.find((item) => item.id === exampleId);
      if (example) Object.assign(example, patch);
      this.withdrawQueuedFor(state, selected.id);
    });
  }

  removeExample(exampleId: string) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('删除示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (target) target.examples = target.examples.filter((item) => item.id !== exampleId);
      this.withdrawQueuedFor(state, selected.id);
    });
  }

  createSnapshot(reason = '手动版本') {
    const selected = this.selected;
    if (!selected) return;
    this.commit('创建版本快照', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      const { snapshots: _ignored, ...component } = clone(target);
      const nextRevision = target.revision + 1;
      const snapshot: ComponentSnapshot = {
        revision: target.revision,
        savedAt: new Date().toISOString(),
        reason,
        component: { ...component, revision: target.revision }
      };
      target.snapshots.unshift(snapshot);
      target.snapshots = target.snapshots.slice(0, 12);
      target.revision = nextRevision;
      target.updatedAt = new Date().toISOString();
    });
  }

  migrateExamples() {
    const selected = this.selected;
    if (!selected) return;
    this.commit('迁移示例到当前版本', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      const currentSignature = signature(target);
      const activePropertyIds = new Set(target.properties.map((item) => item.id));
      target.examples.forEach((example) => {
        example.propertyIds = example.propertyIds.filter((id) => activePropertyIds.has(id));
        example.stale = false;
        example.staleReason = '';
        example.createdFromRevision = target.revision;
      });
      target.interactionSignature = currentSignature.split('::')[1] ?? target.interactionSignature;
      target.revision += 1;
      target.updatedAt = new Date().toISOString();
      this.withdrawQueuedFor(state, selected.id);
    });
  }

  get reviewQueue() { return this.state.reviewQueue; }
  get currentWindow() { return this.state.windows.find((item) => item.id === this.state.currentWindowId); }
  get releaseSnapshots() { return this.state.releaseSnapshots; }
  get submissionFailures() { return this.state.submissionFailures; }

  /** 最终生效结论：仅来自已确认的评审项，发布快照、版本差异和搜索都只读取它。 */
  get effectiveConclusions(): EffectiveConclusion[] {
    return effectiveConclusionsFrom(this.state);
  }

  effectiveConclusionFor(componentId: string): EffectiveConclusion | undefined {
    return this.effectiveConclusions.find((item) => item.componentId === componentId);
  }

  inFlightFor(componentId: string) {
    return this.state.reviewQueue.find(
      (item) => item.componentId === componentId && (item.status === 'queued' || item.status === 'active')
    );
  }

  lastFailureFor(componentId: string) {
    return this.state.submissionFailures.find((item) => item.componentId === componentId);
  }

  /**
   * 送审。先按当前契约重新核验属性与无障碍说明；
   * 依赖示例失效或同组件已有在途评审时整次拒绝，草稿保留并记录失败原因。
   */
  submitForReview(): SubmitResult {
    const selected = this.selected;
    if (!selected) return { ok: false, reason: '未选择组件。' };
    const contractErrors = this.validate().filter(
      (issue) => issue.componentId === selected.id && issue.level === 'error'
    );
    const staleExamples = selected.examples.filter(
      (example) =>
        example.stale || example.propertyIds.some((id) => !selected.properties.some((property) => property.id === id))
    );
    const inFlight = this.inFlightFor(selected.id);
    let reason = '';
    if (contractErrors.length) {
      reason = `属性或无障碍说明未通过当前契约核验：${contractErrors.map((issue) => issue.message).join(' ')}`;
    } else if (staleExamples.length) {
      reason = `依赖示例失效：${staleExamples.map((example) => example.title).join('、')}，请先迁移或修复示例。`;
    } else if (inFlight) {
      reason = `同一组件已有在途评审（${inFlight.status === 'active' ? '评审中' : '排队中'}），本次送审被整次拒绝。`;
    }
    if (reason) {
      this.commit('送审被拒绝', (state) => {
        state.submissionFailures.unshift({
          id: uid('failure'),
          componentId: selected.id,
          componentName: selected.name,
          reason,
          at: new Date().toISOString()
        });
        state.submissionFailures = state.submissionFailures.slice(0, 30);
      });
      return { ok: false, reason };
    }
    this.commit('提交送审', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      const { snapshots: _ignored, ...content } = clone(target);
      state.reviewQueue.push({
        id: uid('review'),
        componentId: target.id,
        componentName: target.name,
        revision: target.revision,
        content,
        status: 'queued',
        submittedAt: new Date().toISOString(),
        startedAt: null,
        resolvedAt: null,
        windowId: null,
        note: ''
      });
      target.status = 'review';
      target.updatedAt = new Date().toISOString();
      this.promoteQueue(state);
    });
    const item = this.inFlightFor(selected.id);
    return {
      ok: true,
      reason: item?.status === 'active' ? '已进入当前窗口评审。' : '窗口名额已满，按提交顺序排队等待。'
    };
  }

  /** 确认或驳回评审中的项；已确认项此后不可被覆盖。 */
  resolveReviewItem(itemId: string, outcome: 'confirmed' | 'rejected', note = '') {
    this.commit(outcome === 'confirmed' ? '确认评审结论' : '驳回评审项', (state) => {
      const item = state.reviewQueue.find((entry) => entry.id === itemId);
      if (!item || item.status !== 'active') return;
      item.status = outcome;
      item.resolvedAt = new Date().toISOString();
      item.note = note || (outcome === 'confirmed' ? '评审通过，结论已生效。' : '评审驳回，可修改后重新送审。');
      const target = state.components.find((entry) => entry.id === item.componentId);
      if (target) {
        target.status = outcome === 'confirmed' ? 'published' : 'draft';
        target.updatedAt = new Date().toISOString();
      }
      this.promoteQueue(state);
    });
  }

  /** 切换发布窗口：未开始项顺延到新窗口并按原顺序补位，已确认项不受影响。 */
  switchWindow() {
    this.commit('切换发布窗口', (state) => {
      const current = state.windows.find((item) => item.id === state.currentWindowId);
      if (current) current.closedAt = new Date().toISOString();
      const id = uid('window');
      state.windows.push({
        id,
        label: `发布窗口 ${state.windows.length + 1}`,
        capacity: REVIEW_CAPACITY,
        startedAt: new Date().toISOString(),
        closedAt: null
      });
      state.currentWindowId = id;
      this.promoteQueue(state);
    });
  }

  /** 发布快照只读取最终生效结论（已确认的评审项），不包含草稿或在途内容。 */
  createReleaseSnapshot() {
    this.commit('生成发布快照', (state) => {
      state.releaseSnapshots.unshift({
        id: uid('release'),
        windowId: state.currentWindowId,
        createdAt: new Date().toISOString(),
        conclusions: effectiveConclusionsFrom(state)
      });
      state.releaseSnapshots = state.releaseSnapshots.slice(0, 12);
    });
  }

  /** 同一组件再次修改时，撤回其未开始（排队中）的旧送审项；重新送审会排到队尾。 */
  private withdrawQueuedFor(state: WorkspaceState, componentId: string) {
    state.reviewQueue.forEach((item) => {
      if (item.componentId === componentId && item.status === 'queued') {
        item.status = 'withdrawn';
        item.resolvedAt = new Date().toISOString();
        item.note = '组件被再次修改，未开始的送审项已撤回；重新送审将排到队尾。';
      }
    });
  }

  /** 按提交顺序把排队项补进当前窗口的空余名额。 */
  private promoteQueue(state: WorkspaceState) {
    const window = state.windows.find((item) => item.id === state.currentWindowId);
    if (!window) return;
    let active = state.reviewQueue.filter((item) => item.status === 'active' && item.windowId === window.id).length;
    for (const item of state.reviewQueue) {
      if (active >= window.capacity) break;
      if (item.status !== 'queued') continue;
      item.status = 'active';
      item.windowId = window.id;
      item.startedAt = new Date().toISOString();
      active += 1;
    }
  }

  validate(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const component of this.state.components) {
      const names = new Map<string, number>();
      component.properties.forEach((property) => names.set(property.name.trim(), (names.get(property.name.trim()) ?? 0) + 1));
      for (const [name, count] of names) {
        if (name && count > 1) {
          issues.push({ id: `${component.id}-duplicate-${name}`, level: 'error', componentId: component.id, target: component.name, message: `属性名称 ${name} 重复。`, field: 'properties' });
        }
      }
      const contractChanged = component.examples.some((example) => example.createdFromRevision < component.revision);
      component.examples.forEach((example) => {
        const missingReferences = example.propertyIds.filter((id) => !component.properties.some((property) => property.id === id));
        if (example.stale || missingReferences.length) {
          issues.push({ id: `${component.id}-${example.id}-stale`, level: 'warning', componentId: component.id, target: example.title, message: example.staleReason || '示例引用了已删除属性。', field: 'examples' });
        }
        if (!example.code.trim()) {
          issues.push({ id: `${component.id}-${example.id}-empty`, level: 'error', componentId: component.id, target: example.title, message: '示例代码不能为空。', field: 'examples' });
        }
      });
      if (!component.keyboardBehavior.trim()) {
        issues.push({ id: `${component.id}-keyboard`, level: 'error', componentId: component.id, target: component.name, message: '缺少键盘行为说明。', field: 'keyboard' });
      }
      if (!component.screenReader.trim()) {
        issues.push({ id: `${component.id}-screenreader`, level: 'error', componentId: component.id, target: component.name, message: '缺少读屏说明。', field: 'screenReader' });
      }
      if (contractChanged && component.examples.length) {
        issues.push({ id: `${component.id}-contract`, level: 'info', componentId: component.id, target: component.name, message: '属性契约或交互签名发生变化，建议创建快照并迁移示例。', field: 'properties' });
      }
    }
    return issues;
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.state));
    this.state = previous;
    this.persist(false);
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.state));
    this.state = next;
    this.persist(false);
    this.emit();
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.state = createInitialState();
    this.persist(false);
    this.emit();
  }

  private commit(label: string, mutator: (state: WorkspaceState) => void) {
    const before = clone(this.state);
    const next = clone(this.state);
    mutator(next);
    this.undoStack.push(before);
    this.undoStack = this.undoStack.slice(-40);
    this.redoStack = [];
    this.lastAction = label;
    this.state = next;
    this.persist();
    this.emit();
  }

  private load(): WorkspaceState {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as WorkspaceState;
        const fallback = createInitialState();
        return {
          ...parsed,
          reviewQueue: parsed.reviewQueue ?? [],
          windows: parsed.windows?.length ? parsed.windows : fallback.windows,
          currentWindowId: parsed.currentWindowId ?? fallback.currentWindowId,
          releaseSnapshots: parsed.releaseSnapshots ?? [],
          submissionFailures: parsed.submissionFailures ?? []
        };
      }
    } catch {
      // A corrupted local draft falls back to the bundled demo data.
    }
    return createInitialState();
  }

  private persist(_notify = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }
}
