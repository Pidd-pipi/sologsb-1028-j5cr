export type ComponentStatus = 'draft' | 'review' | 'published';
export type PreviewTheme = 'light' | 'dark';
export type PreviewDensity = 'compact' | 'regular' | 'spacious';

/** 评审项生命周期：排队中 → 评审中 → 已通过 / 已驳回；排队项被撤回为已撤回。 */
export type ReviewItemStatus = 'waiting' | 'active' | 'approved' | 'rejected' | 'withdrawn';

export interface PropertySpec {
  id: string;
  name: string;
  type: string;
  required: boolean;
  defaultValue: string;
  description: string;
}

export interface ComponentExample {
  id: string;
  title: string;
  code: string;
  propertyIds: string[];
  stale: boolean;
  staleReason: string;
  createdFromRevision: number;
}

export interface ComponentSpec {
  id: string;
  name: string;
  category: string;
  status: ComponentStatus;
  purpose: string;
  usage: string;
  properties: PropertySpec[];
  states: string;
  keyboardBehavior: string;
  screenReader: string;
  disabledScenarios: string;
  interactionSignature: string;
  examples: ComponentExample[];
  revision: number;
  updatedAt: string;
  snapshots: ComponentSnapshot[];
  /** 送审整次拒绝或评审驳回时保留的失败原因，草稿本身不被覆盖。 */
  submitFailures: SubmitFailure[];
}

export interface ComponentSnapshot {
  revision: number;
  savedAt: string;
  reason: string;
  component: Omit<ComponentSpec, 'snapshots'>;
}

/** 送审时刻冻结的契约内容；评审、发布快照、差异都以它为准。 */
export type FrozenSpec = Omit<ComponentSpec, 'snapshots' | 'submitFailures'>;

export interface SubmitFailure {
  id: string;
  at: string;
  revision: number;
  /** precheck：送审前核验整次拒绝；review：评审中被驳回。 */
  stage: 'precheck' | 'review';
  reasons: string[];
}

export interface ReviewItem {
  id: string;
  componentId: string;
  componentName: string;
  /** 自增序号，同时决定 FIFO 队列顺序。 */
  sequence: number;
  status: ReviewItemStatus;
  /** 未开始项尚未被任何窗口受理，窗口切换时顺延。 */
  windowId: string | null;
  revision: number;
  submittedAt: string;
  decidedAt?: string;
  decideReason?: string;
  /** 送审时按当前契约冻结，之后组件再修改也不会覆盖本项。 */
  spec: FrozenSpec;
}

export interface ReviewWindow {
  id: string;
  label: string;
  openedAt: string;
  closedAt?: string;
}

export interface ReleaseSnapshotEntry {
  reviewId: string;
  componentId: string;
  componentName: string;
  revision: number;
  decidedAt: string;
  decideReason?: string;
  spec: FrozenSpec;
}

export interface ReleaseSnapshot {
  generatedAt: string;
  window: ReviewWindow;
  approved: ReleaseSnapshotEntry[];
}

export interface WorkspaceState {
  components: ComponentSpec[];
  selectedId: string;
  windows: ReviewWindow[];
  reviews: ReviewItem[];
  queueSequence: number;
}

export interface SubmitResult {
  ok: boolean;
  /** true 表示当前窗口名额已满，本次送审已按顺序排队。 */
  queued?: boolean;
  reasons?: string[];
}

export interface ValidationIssue {
  id: string;
  level: 'error' | 'warning' | 'info';
  componentId: string;
  target: string;
  message: string;
  field: 'properties' | 'examples' | 'keyboard' | 'screenReader';
}

export interface DiffRow {
  field: string;
  before: string;
  after: string;
}
