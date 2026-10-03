export type ComponentStatus = 'draft' | 'review' | 'published';
export type PreviewTheme = 'light' | 'dark';
export type PreviewDensity = 'compact' | 'regular' | 'spacious';

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
}

export interface ComponentSnapshot {
  revision: number;
  savedAt: string;
  reason: string;
  component: Omit<ComponentSpec, 'snapshots'>;
}

export type ReviewItemStatus = 'queued' | 'active' | 'confirmed' | 'rejected' | 'withdrawn';

export interface ReviewQueueItem {
  id: string;
  componentId: string;
  componentName: string;
  revision: number;
  /** 送审时冻结的内容，确认后即为最终生效结论，之后不可被覆盖。 */
  content: Omit<ComponentSpec, 'snapshots'>;
  status: ReviewItemStatus;
  submittedAt: string;
  startedAt: string | null;
  resolvedAt: string | null;
  /** 开始评审时所属的发布窗口；未开始项为 null，窗口切换时顺延。 */
  windowId: string | null;
  /** 拒绝或撤回原因。 */
  note: string;
}

export interface ReleaseWindow {
  id: string;
  label: string;
  capacity: number;
  startedAt: string;
  closedAt: string | null;
}

export interface EffectiveConclusion {
  componentId: string;
  componentName: string;
  revision: number;
  queueItemId: string;
  confirmedAt: string;
  content: Omit<ComponentSpec, 'snapshots'>;
}

export interface ReleaseSnapshot {
  id: string;
  windowId: string;
  createdAt: string;
  conclusions: EffectiveConclusion[];
}

export interface SubmissionFailure {
  id: string;
  componentId: string;
  componentName: string;
  reason: string;
  at: string;
}

export interface SubmitResult {
  ok: boolean;
  reason: string;
}

export interface WorkspaceState {
  components: ComponentSpec[];
  selectedId: string;
  reviewQueue: ReviewQueueItem[];
  windows: ReleaseWindow[];
  currentWindowId: string;
  releaseSnapshots: ReleaseSnapshot[];
  submissionFailures: SubmissionFailure[];
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
