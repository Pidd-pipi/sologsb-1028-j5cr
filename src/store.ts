import { createInitialState } from './data';
import type {
  ComponentSpec,
  ComponentSnapshot,
  FrozenSpec,
  ReleaseSnapshot,
  ReviewItem,
  ReviewWindow,
  SubmitResult,
  ValidationIssue,
  WorkspaceState
} from './types';

const STORAGE_KEY = 'sologsb-1028-workspace-v2';
const LEGACY_STORAGE_KEY = 'sologsb-1028-workspace-v1';

/** 每个发布窗口的评审名额：受理即占用，窗口关闭后才释放。 */
export const WINDOW_CAPACITY = 3;

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const signature = (component: ComponentSpec) => `${component.properties.map((item) => `${item.name}:${item.required}`).join('|')}::${component.interactionSignature}`;

const freeze = (component: ComponentSpec): FrozenSpec => {
  const { snapshots: _snapshots, submitFailures: _failures, ...rest } = component;
  return clone(rest);
};

/** 用于判断“同一组件再次修改”的契约指纹；updatedAt/status 不参与。 */
const contractHash = (component: ComponentSpec): string => JSON.stringify([
  component.name,
  component.category,
  component.purpose,
  component.usage,
  component.properties,
  component.states,
  component.keyboardBehavior,
  component.screenReader,
  component.disabledScenarios,
  component.interactionSignature,
  component.examples,
  component.revision
]);

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

  get currentWindow(): ReviewWindow | undefined {
    return this.state.windows.find((item) => !item.closedAt);
  }

  get waitingReviews(): ReviewItem[] {
    return this.state.reviews
      .filter((item) => item.status === 'waiting')
      .sort((a, b) => a.sequence - b.sequence);
  }

  select(id: string) {
    if (!this.state.components.some((item) => item.id === id)) return;
    this.state = { ...this.state, selectedId: id };
    this.persist();
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
      snapshots: [],
      submitFailures: []
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
    });
  }

  updateProperty(propertyId: string, patch: Partial<ComponentSpec['properties'][number]>) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (target && property) Object.assign(property, patch);
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
    });
  }

  updateExample(exampleId: string, patch: Partial<ComponentSpec['examples'][number]>) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const example = target?.examples.find((item) => item.id === exampleId);
      if (example) Object.assign(example, patch);
    });
  }

  removeExample(exampleId: string) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('删除示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (target) target.examples = target.examples.filter((item) => item.id !== exampleId);
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
    });
  }

  // ── 发布窗口与评审队列 ─────────────────────────────────────────────

  reviewsFor(componentId: string): ReviewItem[] {
    return this.state.reviews
      .filter((item) => item.componentId === componentId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  /** 在途评审：已受理评审中，或尚未开始排队中的同组件项。 */
  inFlightReview(componentId: string): ReviewItem | undefined {
    return this.state.reviews.find((item) =>
      item.componentId === componentId && (item.status === 'waiting' || item.status === 'active'));
  }

  queuePosition(reviewId: string): number {
    return this.waitingReviews.findIndex((item) => item.id === reviewId) + 1;
  }

  admittedCount(windowId: string): number {
    return this.state.reviews.filter((item) => item.windowId === windowId).length;
  }

  /** 最终生效结论：该组件最近一次通过的冻结契约；从未通过则不存在。 */
  effectiveSpec(componentId: string): FrozenSpec | undefined {
    const approved = this.state.reviews
      .filter((item) => item.componentId === componentId && item.status === 'approved')
      .sort((a, b) => b.sequence - a.sequence);
    return approved[0]?.spec;
  }

  /** 送审前按当前契约重新核验；任何一条不满足都整次拒绝。 */
  precheck(component: ComponentSpec): string[] {
    const reasons: string[] = [];

    if (!component.name.trim()) reasons.push('组件名称不能为空。');

    const names = new Map<string, number>();
    component.properties.forEach((property) => names.set(property.name.trim(), (names.get(property.name.trim()) ?? 0) + 1));
    for (const [name, count] of names) {
      if (!name) {
        reasons.push('存在未命名属性，请补全属性名称。');
      } else if (count > 1) {
        reasons.push(`属性名称 ${name} 重复，契约不允许重名。`);
      }
    }

    if (!component.keyboardBehavior.trim()) reasons.push('缺少键盘行为说明，不符合无障碍契约。');
    if (!component.screenReader.trim()) reasons.push('缺少读屏说明，不符合无障碍契约。');

    if (component.examples.length === 0) {
      reasons.push('至少需要一个可验证的代码示例。');
    }
    const activePropertyIds = new Set(component.properties.map((item) => item.id));
    component.examples.forEach((example) => {
      if (!example.code.trim()) {
        reasons.push(`示例「${example.title || '未命名'}」代码为空。`);
      }
      const missing = example.propertyIds.filter((id) => !activePropertyIds.has(id));
      if (missing.length) {
        reasons.push(`示例「${example.title}」仍引用已删除属性，依赖已失效。`);
      }
      if (example.stale) {
        reasons.push(`示例「${example.title}」已标记失效（${example.staleReason || '契约已变化'}），请先迁移后再送审。`);
      }
      if (example.createdFromRevision < component.revision) {
        reasons.push(`示例「${example.title}」基于 r${example.createdFromRevision}，落后于当前契约 r${component.revision}，需要重新验证。`);
      }
    });

    if (this.inFlightReview(component.id)) {
      reasons.push('同一组件已有在途评审（排队中或评审中），本次送审整次拒绝；继续修改会自动撤回排队项并重排到队尾。');
    }
    return reasons;
  }

  submitForReview(): SubmitResult {
    const component = this.selected;
    if (!component) return { ok: false, reasons: ['未选择组件。'] };

    const reasons = this.precheck(component);
    let queued = false;
    this.commit('送审', (state) => {
      const target = state.components.find((item) => item.id === component.id);
      if (!target) return;
      if (reasons.length) {
        target.submitFailures.unshift({
          id: uid('failure'),
          at: new Date().toISOString(),
          revision: target.revision,
          stage: 'precheck',
          reasons
        });
        target.submitFailures = target.submitFailures.slice(0, 20);
        return;
      }
      let window = state.windows.find((item) => !item.closedAt);
      if (!window) {
        window = { id: uid('window'), label: `发布窗口 #${state.windows.length + 1}`, openedAt: new Date().toISOString() };
        state.windows.push(window);
      }
      const sequence = state.queueSequence++;
      const full = state.reviews.filter((item) => item.windowId === window!.id).length >= WINDOW_CAPACITY;
      const review: ReviewItem = {
        id: uid('review'),
        componentId: target.id,
        componentName: target.name,
        sequence,
        status: full ? 'waiting' : 'active',
        windowId: full ? null : window.id,
        revision: target.revision,
        submittedAt: new Date().toISOString(),
        spec: freeze(target)
      };
      state.reviews.push(review);
      queued = full;
    });
    if (reasons.length) return { ok: false, reasons };
    return { ok: true, queued };
  }

  decideReview(reviewId: string, approved: boolean, reason = '') {
    const review = this.state.reviews.find((item) => item.id === reviewId);
    if (!review || review.status !== 'active') return;
    this.commit(approved ? '评审通过' : '评审驳回', (state) => {
      const target = state.reviews.find((item) => item.id === reviewId);
      if (!target || target.status !== 'active') return;
      target.status = approved ? 'approved' : 'rejected';
      target.decidedAt = new Date().toISOString();
      target.decideReason = reason;
      if (!approved) {
        const component = state.components.find((item) => item.id === target.componentId);
        component?.submitFailures.unshift({
          id: uid('failure'),
          at: target.decidedAt,
          revision: target.revision,
          stage: 'review',
          reasons: [reason || '评审未通过，请按意见修改后重新送审。']
        });
        if (component) component.submitFailures = component.submitFailures.slice(0, 20);
      }
    });
  }

  /** 手动撤回：只允许撤回尚未开始的排队项。 */
  withdrawReview(reviewId: string) {
    const review = this.state.reviews.find((item) => item.id === reviewId);
    if (!review || review.status !== 'waiting') return;
    this.commit('撤回排队评审', (state) => {
      const target = state.reviews.find((item) => item.id === reviewId);
      if (!target || target.status !== 'waiting') return;
      target.status = 'withdrawn';
      target.decidedAt = new Date().toISOString();
      target.decideReason = '维护者手动撤回。';
    });
  }

  /**
   * 切换发布窗口：当前窗口关闭（评审中项留在旧窗口出结论，名额不释放给排队），
   * 未开始项按提交顺序顺延到新窗口，最多受理 WINDOW_CAPACITY 项，其余继续排队。
   */
  advanceWindow(label?: string) {
    this.commit('切换发布窗口', (state) => {
      const open = state.windows.find((item) => !item.closedAt);
      if (open) open.closedAt = new Date().toISOString();
      const nextWindow: ReviewWindow = {
        id: uid('window'),
        label: label?.trim() || `发布窗口 #${state.windows.length + 1}`,
        openedAt: new Date().toISOString()
      };
      state.windows.push(nextWindow);
      const carried = state.reviews
        .filter((item) => item.status === 'waiting')
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, WINDOW_CAPACITY);
      carried.forEach((item) => {
        item.status = 'active';
        item.windowId = nextWindow.id;
      });
    });
  }

  /** 发布快照只汇编某窗口中最终通过（生效）的冻结结论。 */
  releaseSnapshot(windowId: string): ReleaseSnapshot | undefined {
    const window = this.state.windows.find((item) => item.id === windowId);
    if (!window) return undefined;
    const approved = this.state.reviews
      .filter((item) => item.windowId === windowId && item.status === 'approved')
      .sort((a, b) => a.sequence - b.sequence)
      .map((item) => ({
        reviewId: item.id,
        componentId: item.componentId,
        componentName: item.componentName,
        revision: item.revision,
        decidedAt: item.decidedAt ?? '',
        decideReason: item.decideReason,
        spec: item.spec
      }));
    return { generatedAt: new Date().toISOString(), window: clone(window), approved };
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
    this.syncStatuses(this.state);
    this.persist();
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.state));
    this.state = next;
    this.syncStatuses(this.state);
    this.persist();
    this.emit();
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.state = createInitialState();
    this.persist();
    this.emit();
  }

  private commit(label: string, mutator: (state: WorkspaceState) => void) {
    const before = clone(this.state);
    const hashes = new Map(before.components.map((component) => [component.id, contractHash(component)]));
    const next = clone(this.state);
    mutator(next);
    // 同一组件再次修改：撤回未开始旧项，冻结当前契约排到队尾；已受理/已确认项不动。
    const notices: string[] = [];
    for (const component of next.components) {
      if (hashes.get(component.id) !== undefined && hashes.get(component.id) !== contractHash(component)) {
        const pending = next.reviews.filter((item) => item.componentId === component.id && item.status === 'waiting');
        if (pending.length) {
          pending.forEach((item) => {
            item.status = 'withdrawn';
            item.decidedAt = new Date().toISOString();
            item.decideReason = '组件契约在排队期间再次修改，旧排队项撤回。';
          });
          next.reviews.push({
            id: uid('review'),
            componentId: component.id,
            componentName: component.name,
            sequence: next.queueSequence++,
            status: 'waiting',
            windowId: null,
            revision: component.revision,
            submittedAt: new Date().toISOString(),
            spec: freeze(component)
          });
          notices.push(`「${component.name}」契约已修改，旧排队项撤回，新版本已重排到队尾。`);
        }
      }
    }
    this.syncStatuses(next);
    this.undoStack.push(before);
    this.undoStack = this.undoStack.slice(-40);
    this.redoStack = [];
    this.lastAction = label;
    this.state = next;
    this.persist();
    this.emit(notices.join(' '));
  }

  /** 组件状态由评审结论派生，不允许手工覆盖已确认项。 */
  private syncStatuses(state: WorkspaceState) {
    for (const component of state.components) {
      const reviews = state.reviews
        .filter((item) => item.componentId === component.id && item.status !== 'withdrawn')
        .sort((a, b) => b.sequence - a.sequence);
      const latest = reviews[0];
      if (!latest) {
        component.status = 'draft';
        continue;
      }
      if (latest.status === 'approved') component.status = 'published';
      else if (latest.status === 'active' || latest.status === 'waiting') component.status = 'review';
      else component.status = reviews.some((item) => item.status === 'approved') ? 'published' : 'draft';
    }
  }

  private load(): WorkspaceState {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as WorkspaceState;
        if (Array.isArray(parsed.windows) && Array.isArray(parsed.reviews)) return parsed;
      }
      // 从 v1 草稿迁移：评审数据从空开始，旧状态全部回到草稿。
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const migrated = JSON.parse(legacy) as WorkspaceState;
        migrated.windows = [];
        migrated.reviews = [];
        migrated.queueSequence = 1;
        migrated.components.forEach((component) => {
          component.submitFailures = [];
          component.status = 'draft';
        });
        return migrated;
      }
    } catch {
      // A corrupted local draft falls back to the bundled demo data.
    }
    return createInitialState();
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private emit(notice = '') {
    this.dispatchEvent(new CustomEvent('state-changed', { detail: { notice } }));
    this.dispatchEvent(new CustomEvent('change'));
  }
}
