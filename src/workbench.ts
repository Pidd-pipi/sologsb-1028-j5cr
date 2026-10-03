import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { diffAgainstSnapshot, diffSpecs } from './diff';
import { SpecStore, WINDOW_CAPACITY } from './store';
import type {
  ComponentExample,
  ComponentSpec,
  FrozenSpec,
  PreviewDensity,
  PreviewTheme,
  PropertySpec,
  ReviewItem,
  ReviewWindow,
  ValidationIssue
} from './types';

type EditorTab = 'overview' | 'api' | 'accessibility' | 'examples' | 'review' | 'history';
type ReviewBadge = ReviewItem['status'];

export class SpecA11yWorkbench extends LitElement {
  static properties = {
    query: { state: true },
    tab: { state: true },
    previewTheme: { state: true },
    previewDensity: { state: true },
    toast: { state: true },
    showValidation: { state: true },
    snapshotWindowId: { state: true }
  };

  private store = new SpecStore();
  private query = '';
  private tab: EditorTab = 'overview';
  private previewTheme: PreviewTheme = 'light';
  private previewDensity: PreviewDensity = 'regular';
  private toast = '';
  private showValidation = true;
  private snapshotWindowId = '';
  private toastTimer?: number;

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      color: var(--spectrum-gray-900);
      background: linear-gradient(135deg, var(--spectrum-gray-100), var(--spectrum-blue-100));
      font-family: var(--spectrum-sans-font-family, Inter, ui-sans-serif, system-ui);
    }
    * { box-sizing: border-box; }
    .app { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    header {
      position: sticky; top: 0; z-index: 20;
      display: flex; align-items: center; gap: 18px; padding: 14px 22px;
      background: color-mix(in srgb, var(--spectrum-gray-50) 92%, transparent);
      border-bottom: 1px solid var(--spectrum-gray-300); backdrop-filter: blur(14px);
    }
    .brand { min-width: 245px; }
    .brand h1 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
    .brand p { margin: 3px 0 0; color: var(--spectrum-gray-700); font-size: 12px; }
    .toolbar { display: flex; align-items: center; gap: 8px; flex: 1; }
    .toolbar sp-search { min-width: 280px; flex: 1; max-width: 520px; }
    .save-state { color: var(--spectrum-gray-700); font-size: 12px; white-space: nowrap; }
    .layout {
      display: grid; grid-template-columns: minmax(245px, 290px) minmax(0, 1fr) minmax(315px, 390px);
      min-height: calc(100vh - 72px);
    }
    .sidebar, .inspector { background: color-mix(in srgb, var(--spectrum-gray-50) 90%, transparent); }
    .sidebar { border-right: 1px solid var(--spectrum-gray-300); padding: 18px 12px; }
    .sidebar-heading { display: flex; justify-content: space-between; align-items: center; padding: 0 8px 12px; }
    .sidebar-heading h2, .panel h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; }
    .component-list { display: grid; gap: 7px; }
    .component-item {
      width: 100%; text-align: left; border: 1px solid transparent; border-radius: 10px;
      background: transparent; color: inherit; padding: 11px 12px; cursor: pointer;
    }
    .component-item:hover { background: var(--spectrum-gray-200); }
    .component-item[aria-current='page'] { border-color: var(--spectrum-blue-600); background: var(--spectrum-blue-200); }
    .item-title { display: flex; justify-content: space-between; gap: 8px; font-weight: 700; }
    .item-meta { display: block; color: var(--spectrum-gray-700); font-size: 12px; margin-top: 5px; }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 7px; font-size: 10px; font-weight: 700; background: var(--spectrum-gray-300); }
    .pill.published { background: var(--spectrum-green-300); }
    .pill.review { background: var(--spectrum-orange-300); }
    .main { min-width: 0; padding: 22px; }
    .title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; margin-bottom: 16px; }
    .title-row h2 { font-size: 28px; margin: 0; letter-spacing: -.035em; }
    .title-row p { margin: 6px 0 0; color: var(--spectrum-gray-700); }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .tabs { display: flex; gap: 5px; overflow-x: auto; padding: 5px; border: 1px solid var(--spectrum-gray-300); border-radius: 12px; background: var(--spectrum-gray-100); margin-bottom: 16px; }
    .tab { border: 0; border-radius: 8px; background: transparent; color: var(--spectrum-gray-800); padding: 8px 12px; font: inherit; cursor: pointer; white-space: nowrap; }
    .tab[aria-selected='true'] { background: var(--spectrum-gray-50); box-shadow: 0 1px 4px rgb(0 0 0 / .12); font-weight: 700; }
    .panel { border: 1px solid var(--spectrum-gray-300); border-radius: 16px; background: var(--spectrum-gray-50); padding: 20px; box-shadow: 0 8px 26px rgb(20 30 50 / .06); }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .field { display: grid; gap: 7px; min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    .field > span { font-size: 12px; font-weight: 700; }
    textarea, input[type='text'], select {
      width: 100%; border: 1px solid var(--spectrum-gray-400); border-radius: 8px;
      padding: 9px 10px; background: var(--spectrum-gray-50); color: var(--spectrum-gray-900);
      font: inherit; line-height: 1.5;
    }
    textarea:focus, input:focus, select:focus { outline: 3px solid var(--spectrum-blue-400); outline-offset: 1px; border-color: var(--spectrum-blue-700); }
    textarea { min-height: 110px; resize: vertical; }
    .property-list, .example-list { display: grid; gap: 12px; }
    .property-card, .example-card { border: 1px solid var(--spectrum-gray-300); border-radius: 12px; padding: 14px; background: var(--spectrum-gray-75, var(--spectrum-gray-100)); }
    .property-head, .example-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .property-head strong, .example-head strong { flex: 1; }
    .inline { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .empty { padding: 28px; border: 1px dashed var(--spectrum-gray-400); border-radius: 12px; text-align: center; color: var(--spectrum-gray-700); }
    .inspector { border-left: 1px solid var(--spectrum-gray-300); padding: 18px; display: grid; align-content: start; gap: 15px; }
    .preview { border-radius: 14px; border: 1px solid var(--spectrum-gray-400); padding: 18px; display: grid; place-items: center; min-height: 150px; transition: .2s; }
    .preview.dark { background: #1b1b1b; color: #f5f5f5; border-color: #444; }
    .preview.light { background: #fff; color: #111; }
    .preview.compact { padding: 9px; }
    .preview.regular { padding: 18px; }
    .preview.spacious { padding: 32px; }
    .demo-button { border: 0; border-radius: 8px; padding: 10px 16px; background: #1473e6; color: white; font: inherit; }
    .issue { border-left: 4px solid var(--spectrum-gray-500); border-radius: 8px; background: var(--spectrum-gray-100); padding: 10px 11px; margin-bottom: 8px; font-size: 12px; }
    .issue.error { border-color: var(--spectrum-red-600); }
    .issue.warning { border-color: var(--spectrum-orange-600); }
    .issue.info { border-color: var(--spectrum-blue-600); }
    .issue strong { display: block; margin-bottom: 3px; }
    .issue button { border: 0; background: transparent; color: var(--spectrum-blue-800); padding: 0; cursor: pointer; text-decoration: underline; }
    .diff { display: grid; gap: 7px; margin-top: 9px; }
    .diff-row { border: 1px solid var(--spectrum-gray-300); border-radius: 8px; padding: 9px; font-size: 11px; }
    .diff-row b { display: block; margin-bottom: 4px; text-transform: capitalize; }
    .before { color: var(--spectrum-red-800); white-space: pre-wrap; }
    .after { color: var(--spectrum-green-900); white-space: pre-wrap; }
    pre { white-space: pre-wrap; word-break: break-word; background: #202020; color: #f5f5f5; padding: 12px; border-radius: 8px; font-size: 12px; }
    .search-empty { padding: 20px 8px; color: var(--spectrum-gray-700); font-size: 13px; }
    .review-list { display: grid; gap: 8px; margin-top: 8px; }
    .review-card { border: 1px solid var(--spectrum-gray-300); border-radius: 10px; padding: 10px 12px; background: var(--spectrum-gray-75, var(--spectrum-gray-100)); }
    .queue-panel h3 { margin: 14px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    .muted { color: var(--spectrum-gray-700); font-size: 12px; margin: 4px 0; }
    .linklike { cursor: pointer; font-size: 12px; color: var(--spectrum-blue-800); }
    .pill.draft { background: var(--spectrum-red-300, var(--spectrum-gray-300)); }
    .footer-hint { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); z-index: 30; background: #202020; color: white; border-radius: 999px; padding: 6px 12px; font-size: 11px; opacity: .9; }
    sp-toast { position: fixed; right: 18px; bottom: 18px; z-index: 50; }
    @media (max-width: 1180px) {
      .layout { grid-template-columns: 230px minmax(0, 1fr); }
      .inspector { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--spectrum-gray-300); grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      header { flex-wrap: wrap; padding: 12px; }
      .brand { min-width: 100%; }
      .toolbar { flex-wrap: wrap; }
      .toolbar sp-search { min-width: 100%; }
      .layout { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--spectrum-gray-300); }
      .inspector { grid-template-columns: 1fr; }
      .form-grid { grid-template-columns: 1fr; }
      .field.full { grid-column: auto; }
      .main { padding: 14px; }
      .title-row { display: grid; }
      .actions { justify-content: flex-start; }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.store.addEventListener('change', this.onStoreChange);
    this.store.addEventListener('state-changed', this.onStateChanged);
    window.addEventListener('keydown', this.onKeyDown);
    if (!this.snapshotWindowId) this.snapshotWindowId = this.store.currentWindow?.id ?? '';
  }

  disconnectedCallback() {
    this.store.removeEventListener('change', this.onStoreChange);
    this.store.removeEventListener('state-changed', this.onStateChanged);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private onStoreChange = () => {
    this.requestUpdate();
  };

  private onStateChanged = (event: Event) => {
    const notice = (event as CustomEvent<{ notice?: string }>).detail?.notice;
    if (notice) this.flash(notice);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.store.redo() : this.store.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.store.createSnapshot('键盘保存');
      this.flash('已创建版本快照');
      return;
    }
    if (modifier && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.renderRoot.querySelector<HTMLElement>('sp-search')?.focus();
      return;
    }
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.store.addComponent();
      return;
    }
    const tabMap: Record<string, EditorTab> = { '1': 'overview', '2': 'api', '3': 'accessibility', '4': 'examples', '5': 'review', '6': 'history' };
    if (event.altKey && tabMap[event.key]) {
      event.preventDefault();
      this.tab = tabMap[event.key];
    }
  };

  protected render(): TemplateResult {
    const selected = this.store.selected;
    const issues = this.store.validate();
    const selectedIssues = selected ? issues.filter((item) => item.componentId === selected.id) : [];
    const filtered = this.filteredComponents;
    return html`
      <sp-theme color=${this.previewTheme === 'dark' ? 'dark' : 'light'} scale=${this.previewDensity === 'compact' ? 'medium' : 'large'}>
        <div class="app">
          <header>
            <div class="brand">
              <h1>Component Contract Studio</h1>
              <p>规范、无障碍与发布评审排队</p>
            </div>
            <div class="toolbar">
              <sp-search
                placeholder="搜索已生效结论：组件、属性、键盘行为或示例"
                aria-label="生效结论全文搜索"
                .value=${this.query}
                @input=${(event: Event) => { this.query = (event.currentTarget as HTMLInputElement & { value?: string }).value ?? ''; }}
              ></sp-search>
              <sp-button variant="secondary" ?disabled=${!this.store.canUndo} @click=${() => this.store.undo()}>撤销</sp-button>
              <sp-button variant="secondary" ?disabled=${!this.store.canRedo} @click=${() => this.store.redo()}>重做</sp-button>
              <sp-button variant="accent" @click=${() => { this.store.createSnapshot('工具栏保存'); this.flash('版本已保存'); }}>保存版本</sp-button>
              <span class="save-state">本地自动保存 · ${selected?.revision ?? 0} 版</span>
            </div>
          </header>
          <div class="layout">
            <aside class="sidebar" aria-label="组件目录">
              <div class="sidebar-heading">
                <h2>组件目录</h2>
                <sp-action-button size="s" label="新建组件" @click=${() => this.store.addComponent()}>＋</sp-action-button>
              </div>
              <div class="component-list">
                ${filtered.length ? repeat(filtered, (item) => item.id, (item) => html`
                  <button class="component-item" aria-current=${item.id === this.store.state.selectedId ? 'page' : nothing} @click=${() => this.store.select(item.id)}>
                    <span class="item-title">
                      <span>${item.name}</span>
                      <span class="pill ${item.status}">${this.statusLabel(item.status)}</span>
                    </span>
                    <span class="item-meta">${item.category} · ${item.properties.length} 个属性 · ${item.examples.length} 个示例</span>
                  </button>
                `) : html`<div class="search-empty">没有匹配的已发布组件。搜索只覆盖评审通过后的最终生效结论，草稿与在途内容不会出现。</div>`}
              </div>
            </aside>
            <main class="main">${selected ? this.renderEditor(selected) : html`<div class="empty">新建或选择组件开始编辑。</div>`}</main>
            <aside class="inspector" aria-label="预览与检查">
              ${this.renderReviewQueue()}
              ${this.renderPreview(selected)}
              ${this.renderValidation(selectedIssues)}
            </aside>
          </div>
          ${this.toast ? html`<sp-toast open variant="positive" timeout="3000">${this.toast}</sp-toast>` : nothing}
          <div class="footer-hint">⌘/Ctrl+Z 撤销 · ⇧⌘/Ctrl+Z 重做 · ⌘/Ctrl+K 搜索 · Alt+1–6 切换面板</div>
        </div>
      </sp-theme>
    `;
  }

  private renderEditor(component: ComponentSpec): TemplateResult {
    return html`
      <div class="title-row">
        <div>
          <h2>${component.name}</h2>
          <p>${component.purpose}</p>
        </div>
        <div class="actions">
          <span class="pill ${component.status}">${this.statusLabel(component.status)}</span>
          <sp-button variant="secondary" @click=${() => this.store.createSnapshot('编辑器保存')}>保存草稿快照</sp-button>
          <sp-button variant="accent" @click=${() => this.submit()}>送审</sp-button>
        </div>
      </div>
      <div class="tabs" role="tablist" aria-label="编辑区域">
        ${this.renderTab('overview', '1 概述')}
        ${this.renderTab('api', '2 属性与状态')}
        ${this.renderTab('accessibility', '3 无障碍')}
        ${this.renderTab('examples', '4 示例')}
        ${this.renderTab('review', '5 发布评审')}
        ${this.renderTab('history', '6 版本')}
      </div>
      ${this.tab === 'overview' ? this.renderOverview(component) : nothing}
      ${this.tab === 'api' ? this.renderApi(component) : nothing}
      ${this.tab === 'accessibility' ? this.renderAccessibility(component) : nothing}
      ${this.tab === 'examples' ? this.renderExamples(component) : nothing}
      ${this.tab === 'review' ? this.renderReviewTab(component) : nothing}
      ${this.tab === 'history' ? this.renderHistory(component) : nothing}
    `;
  }

  private renderTab(tab: EditorTab, label: string): TemplateResult {
    return html`<button class="tab" role="tab" aria-selected=${this.tab === tab} @click=${() => { this.tab = tab; }}>${label}</button>`;
  }

  private renderOverview(component: ComponentSpec): TemplateResult {
    return html`
      <section class="panel" aria-label="组件概述">
        <div class="form-grid">
          <label class="field"><span>组件名称</span><input type="text" .value=${component.name} @change=${(event: Event) => this.store.updateComponent({ name: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field"><span>分类</span><input type="text" .value=${component.category} @change=${(event: Event) => this.store.updateComponent({ category: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field full"><span>用途</span><textarea .value=${component.purpose} @change=${(event: Event) => this.store.updateComponent({ purpose: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>使用规则</span><textarea .value=${component.usage} @change=${(event: Event) => this.store.updateComponent({ usage: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>禁用场景</span><textarea .value=${component.disabledScenarios} @change=${(event: Event) => this.store.updateComponent({ disabledScenarios: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </section>
    `;
  }

  private renderApi(component: ComponentSpec): TemplateResult {
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>属性契约</h2>
          <sp-button size="s" variant="secondary" @click=${() => this.store.addProperty()}>新增属性</sp-button>
        </div>
        <div class="property-list">
          ${component.properties.length ? repeat(component.properties, (item) => item.id, (property) => this.renderProperty(property)) : html`<div class="empty">尚未定义属性。</div>`}
        </div>
        <div class="form-grid" style="margin-top: 18px">
          <label class="field full"><span>状态说明</span><textarea .value=${component.states} @change=${(event: Event) => this.store.updateComponent({ states: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>交互签名（修改后会标记关联示例失效）</span><textarea .value=${component.interactionSignature} @change=${(event: Event) => this.store.updateComponent({ interactionSignature: (event.currentTarget as HTMLTextAreaElement).value }, true)}></textarea></label>
        </div>
      </section>
    `;
  }

  private renderProperty(property: PropertySpec): TemplateResult {
    return html`
      <article class="property-card">
        <div class="property-head">
          <strong>${property.name || '未命名属性'}</strong>
          <sp-action-button size="s" label="删除属性" @click=${() => this.store.removeProperty(property.id)}>删除</sp-action-button>
        </div>
        <div class="form-grid">
          <label class="field"><span>名称</span><input type="text" .value=${property.name} @change=${(event: Event) => this.store.updateProperty(property.id, { name: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field"><span>类型</span><input type="text" .value=${property.type} @change=${(event: Event) => this.store.updateProperty(property.id, { type: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field"><span>默认值</span><input type="text" .value=${property.defaultValue} @change=${(event: Event) => this.store.updateProperty(property.id, { defaultValue: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="inline"><input type="checkbox" .checked=${property.required} @change=${(event: Event) => this.store.updateProperty(property.id, { required: (event.currentTarget as HTMLInputElement).checked })} /> 必填属性</label>
          <label class="field full"><span>属性说明</span><textarea .value=${property.description} @change=${(event: Event) => this.store.updateProperty(property.id, { description: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </article>
    `;
  }

  private renderAccessibility(component: ComponentSpec): TemplateResult {
    return html`
      <section class="panel">
        <div class="form-grid">
          <label class="field full"><span>键盘行为</span><textarea .value=${component.keyboardBehavior} @change=${(event: Event) => this.store.updateComponent({ keyboardBehavior: (event.currentTarget as HTMLTextAreaElement).value }, true)}></textarea></label>
          <label class="field full"><span>读屏说明</span><textarea .value=${component.screenReader} @change=${(event: Event) => this.store.updateComponent({ screenReader: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>禁用场景</span><textarea .value=${component.disabledScenarios} @change=${(event: Event) => this.store.updateComponent({ disabledScenarios: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </section>
    `;
  }

  private renderExamples(component: ComponentSpec): TemplateResult {
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>关联示例</h2>
          <sp-button size="s" variant="secondary" @click=${() => this.store.addExample()}>新增示例</sp-button>
        </div>
        <div class="example-list">
          ${component.examples.length ? repeat(component.examples, (item) => item.id, (example) => this.renderExample(component, example)) : html`<div class="empty">尚无示例。新增后会追踪属性依赖和版本契约。</div>`}
        </div>
      </section>
    `;
  }

  private renderExample(component: ComponentSpec, example: ComponentExample): TemplateResult {
    return html`
      <article class="example-card">
        <div class="example-head">
          <strong>${example.title}</strong>
          <span class="pill ${example.stale ? 'review' : 'published'}">${example.stale ? '需要迁移' : `r${example.createdFromRevision}`}</span>
          <sp-action-button size="s" label="复制代码" @click=${() => this.copy(example.code)}>复制</sp-action-button>
          <sp-action-button size="s" label="删除示例" @click=${() => this.store.removeExample(example.id)}>删除</sp-action-button>
        </div>
        ${example.stale ? html`<div class="issue warning"><strong>关联失效</strong>${example.staleReason}</div>` : nothing}
        <div class="form-grid">
          <label class="field full"><span>标题</span><input type="text" .value=${example.title} @change=${(event: Event) => this.store.updateExample(example.id, { title: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field full"><span>代码</span><textarea .value=${example.code} @change=${(event: Event) => this.store.updateExample(example.id, { code: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <div class="field full">
            <span>依赖属性</span>
            <div class="inline" style="flex-wrap: wrap">
              ${component.properties.map((property) => html`
                <label class="inline"><input type="checkbox" .checked=${example.propertyIds.includes(property.id)} @change=${(event: Event) => {
                  const values = new Set(example.propertyIds);
                  (event.currentTarget as HTMLInputElement).checked ? values.add(property.id) : values.delete(property.id);
                  this.store.updateExample(example.id, { propertyIds: [...values] });
                }} /> ${property.name}</label>
              `)}
              ${!component.properties.length ? html`<span>当前组件没有属性。</span>` : nothing}
            </div>
          </div>
          <div class="field full"><pre>${example.code}</pre></div>
        </div>
      </article>
    `;
  }

  private renderHistory(component: ComponentSpec): TemplateResult {
    const snapshot = component.snapshots[0];
    const rows = diffAgainstSnapshot(component, snapshot);
    const effective = this.store.effectiveSpec(component.id);
    const effectiveRows = effective ? diffSpecs(effective, this.withoutMeta(component)) : [];
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>版本与迁移</h2>
          <sp-button size="s" variant="secondary" @click=${() => this.store.createSnapshot('历史面板保存')}>保存当前草稿</sp-button>
        </div>
        <p>当前草稿为 r${component.revision}。最近本地快照：${snapshot ? `r${snapshot.revision} · ${new Date(snapshot.savedAt).toLocaleString('zh-CN')}` : '暂无'}。</p>

        <h3>与最终生效结论的差异</h3>
        ${effective ? html`
          <p class="muted">生效版本 r${effective.revision}${this.latestApproval(component.id) ? html`，评审通过时间：${new Date(this.latestApproval(component.id)!.decidedAt!).toLocaleString('zh-CN')}` : nothing}。版本差异只读取该冻结结论，不读取在途或草稿内容。</p>
          ${effectiveRows.length ? this.renderDiffRows(effectiveRows) : html`<div class="issue info"><strong>草稿与生效结论一致</strong>没有待发布的字段变化。</div>`}
        ` : html`<div class="empty">该组件尚无评审通过的生效结论，发布后即可对照版本差异。</div>`}

        <h3 style="margin-top:18px">本地草稿快照</h3>
        ${snapshot ? html`
          ${rows.length ? this.renderDiffRows(rows) : html`<div class="issue info">当前草稿与最近本地快照一致。</div>`}
        ` : html`<div class="empty">保存一次草稿后即可比较字段、属性和示例变化。本地快照不参与发布。</div>`}
        ${this.hasStaleExamples(component) ? html`<div class="issue warning" style="margin-top: 14px"><strong>检测到待迁移示例</strong>迁移会保留代码内容，清理已删除属性引用并更新契约版本。<br /><button @click=${() => { this.store.migrateExamples(); this.flash('示例已迁移到当前契约'); }}>立即迁移</button></div>` : nothing}
      </section>
    `;
  }

  private renderDiffRows(rows: ReturnType<typeof diffSpecs>): TemplateResult {
    return html`<div class="diff">${rows.map((row) => html`<div class="diff-row"><b>${this.fieldLabel(row.field)}</b><span class="before">- ${row.before || '（空）'}</span><br /><span class="after">+ ${row.after || '（空）'}</span></div>`)}</div>`;
  }

  private fieldLabel(field: string): string {
    return ({
      name: '名称', category: '分类', status: '状态', purpose: '用途', usage: '使用规则', states: '状态说明',
      keyboardBehavior: '键盘行为', screenReader: '读屏说明', disabledScenarios: '禁用场景',
      properties: '属性契约', examples: '关联示例'
    } as Record<string, string>)[field] ?? field;
  }

  private withoutMeta(component: ComponentSpec): FrozenSpec {
    const { snapshots: _s, submitFailures: _f, ...rest } = component;
    return rest;
  }

  private renderPreview(component?: ComponentSpec): TemplateResult {
    if (!component) return html`<section class="panel"><h2>预览</h2><p>选择组件后显示主题与密度预览。</p></section>`;
    return html`
      <section class="panel">
        <div class="property-head"><h2>实时预览</h2><button class="tab" @click=${() => { this.previewTheme = this.previewTheme === 'light' ? 'dark' : 'light'; }}>${this.previewTheme === 'light' ? '深色' : '浅色'}</button></div>
        <div class="inline" style="margin-bottom: 10px">
          <label>密度</label>
          <select .value=${this.previewDensity} @change=${(event: Event) => { this.previewDensity = (event.currentTarget as HTMLSelectElement).value as PreviewDensity; }}>
            <option value="compact">紧凑</option>
            <option value="regular">标准</option>
            <option value="spacious">宽松</option>
          </select>
        </div>
        <div class="preview ${this.previewTheme} ${this.previewDensity}">
          ${component.category === 'Forms'
            ? html`<label style="width:100%"><span style="display:block;font-size:12px;margin-bottom:6px">${component.properties.find((item) => item.name === 'label')?.defaultValue ?? '字段标签'}</span><input style="width:100%;padding:10px;border:1px solid #888;border-radius:8px" placeholder="输入内容" /></label>`
            : html`<button class="demo-button">${component.properties.find((item) => item.name === 'label')?.defaultValue ?? component.name}</button>`}
        </div>
      </section>
    `;
  }

  private renderValidation(issues: ValidationIssue[]): TemplateResult {
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>规范检查</h2>
          <sp-button size="s" variant="secondary" @click=${() => { this.showValidation = !this.showValidation; }}>${this.showValidation ? '收起' : '展开'}</sp-button>
        </div>
        ${this.showValidation ? (issues.length ? issues.map((issue) => html`
          <div class="issue ${issue.level}"><strong>${issue.target}</strong>${issue.message}</div>
        `) : html`<div class="issue info"><strong>当前组件通过检查</strong>没有发现属性、示例或无障碍说明问题。</div>`) : nothing}
      </section>
    `;
  }

  private get filteredComponents(): ComponentSpec[] {
    const query = this.query.trim().toLowerCase();
    if (!query) return this.store.state.components;
    // 搜索只读取最终生效结论：仅在最近一次评审通过的冻结契约内匹配。
    return this.store.state.components.filter((component) => {
      const effective = this.store.effectiveSpec(component.id);
      return effective ? JSON.stringify(effective).toLowerCase().includes(query) : false;
    });
  }

  private hasStaleExamples(component: ComponentSpec): boolean {
    return component.examples.some((example) => example.stale);
  }

  private statusLabel(status: ComponentSpec['status']): string {
    return { draft: '草稿', review: '在途', published: '已发布' }[status];
  }

  private reviewBadgeLabel(status: ReviewBadge): string {
    return { waiting: '排队中', active: '评审中', approved: '已通过', rejected: '已驳回', withdrawn: '已撤回' }[status];
  }

  private windowLabel(id: string | null): string {
    if (!id) return '等待窗口受理';
    return this.store.state.windows.find((item) => item.id === id)?.label ?? '未知窗口';
  }

  private latestApproval(componentId: string): ReviewItem | undefined {
    return this.store.reviewsFor(componentId).filter((item) => item.status === 'approved').sort((a, b) => b.sequence - a.sequence)[0];
  }

  private submit() {
    const result = this.store.submitForReview();
    if (!result.ok) {
      this.tab = 'review';
      this.flash('送审被整次拒绝，草稿与失败原因已保留');
      return;
    }
    this.tab = 'review';
    this.flash(result.queued ? `当前窗口 ${WINDOW_CAPACITY} 个名额已满，已按提交顺序排队` : '已受理进入当前发布窗口评审');
  }

  private renderReviewTab(component: ComponentSpec): TemplateResult {
    const reviews = this.store.reviewsFor(component.id);
    const precheck = this.store.precheck(component);
    const inFlight = this.store.inFlightReview(component.id);
    const effective = this.store.effectiveSpec(component.id);
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>发布评审</h2>
          <sp-button size="s" variant="accent" @click=${() => this.submit()}>送审</sp-button>
        </div>

        <div class="issue ${inFlight ? 'warning' : 'info'}">
          <strong>${inFlight ? `存在在途评审：${this.reviewBadgeLabel(inFlight.status)}` : '当前没有在途评审'}</strong>
          ${inFlight
            ? html`依据 r${inFlight.revision} 冻结契约（${new Date(inFlight.submittedAt).toLocaleString('zh-CN')} 提交）。同组件再次送审会被整次拒绝；继续修改草稿不会覆盖该结论，排队项会自动撤回并重排到队尾。`
            : '送审前会按当前契约重新核验属性、无障碍说明与示例依赖。'}
        </div>

        <h3>送审前核验（实时）</h3>
        ${precheck.length ? html`
          <p class="muted">以下问题存在时整次拒绝送审，草稿保留不被改动：</p>
          ${precheck.map((reason) => html`<div class="issue error">${reason}</div>`)}
        ` : html`<div class="issue info"><strong>核验通过</strong>属性契约、键盘/读屏说明与全部示例依赖均有效，可以送审。</div>`}

        <h3 style="margin-top:16px">评审记录</h3>
        ${reviews.length ? html`<div class="review-list">${reviews.map((review) => this.renderReviewRow(review))}</div>` : html`<div class="empty">该组件还没有送审记录。</div>`}

        ${component.submitFailures.length ? html`
          <h3 style="margin-top:16px">失败原因（草稿保留）</h3>
          ${component.submitFailures.map((failure) => html`
            <div class="issue error">
              <strong>${failure.stage === 'precheck' ? '送审拒绝' : '评审驳回'} · r${failure.revision} · ${new Date(failure.at).toLocaleString('zh-CN')}</strong>
              ${failure.reasons.map((reason) => html`<div>${reason}</div>`)}
            </div>`)}
        ` : nothing}
        ${effective ? html`<p class="muted" style="margin-top:12px">最终生效结论：r${effective.revision}，已通过评审不可被后续修改覆盖。</p>` : nothing}
      </section>
    `;
  }

  private renderReviewRow(review: ReviewItem): TemplateResult {
    const position = review.status === 'waiting' ? this.store.queuePosition(review.id) : 0;
    return html`
      <article class="review-card">
        <div class="property-head">
          <strong>#${review.sequence} · r${review.revision} · ${review.componentName}</strong>
          <span class="pill ${review.status === 'approved' ? 'published' : review.status === 'rejected' || review.status === 'withdrawn' ? 'draft' : 'review'}">${this.reviewBadgeLabel(review.status)}${position ? ` · 队位 ${position}` : ''}</span>
        </div>
        <div class="muted">
          提交于 ${new Date(review.submittedAt).toLocaleString('zh-CN')} · ${this.windowLabel(review.windowId)}
          ${review.decidedAt ? html` · 结论时间 ${new Date(review.decidedAt).toLocaleString('zh-CN')}` : ''}
        </div>
        ${review.decideReason ? html`<div class="muted">结论说明：${review.decideReason}</div>` : nothing}
        <div class="inline" style="margin-top:6px">
          ${review.status === 'waiting'
            ? html`<sp-button size="s" variant="secondary" @click=${() => this.store.withdrawReview(review.id)}>撤回排队项</sp-button>`
            : nothing}
          <details><summary class="linklike">查看送审时冻结契约</summary><pre>${JSON.stringify(review.spec, null, 2)}</pre></details>
        </div>
      </article>
    `;
  }

  private renderReviewQueue(): TemplateResult {
    const window = this.store.currentWindow;
    const admitted = window ? this.store.state.reviews.filter((item) => item.windowId === window.id) : [];
    const waiting = this.store.waitingReviews;
    const activeReviews = this.store.state.reviews.filter((item) => item.status === 'active');
    const windows = [...this.store.state.windows].reverse();
    const selectedWindowId = this.snapshotWindowId || window?.id || windows[0]?.id || '';
    const snapshot = selectedWindowId ? this.store.releaseSnapshot(selectedWindowId) : undefined;
    return html`
      <section class="panel queue-panel">
        <div class="property-head">
          <h2>发布窗口 · ${WINDOW_CAPACITY} 名额</h2>
          <sp-button size="s" variant="secondary" @click=${() => { this.store.advanceWindow(); this.snapshotWindowId = this.store.currentWindow?.id ?? this.snapshotWindowId; }}>切换窗口</sp-button>
        </div>
        ${window ? html`
          <p class="muted"><strong>${window.label}</strong>（${new Date(window.openedAt).toLocaleDateString('zh-CN')} 开启）<br/>
          已受理 ${admitted.length}/${WINDOW_CAPACITY}：受理即占名额，驳回也不释放；满员后新送审排队等待下一窗口。</p>
          <div class="review-list">
            ${admitted.sort((a, b) => a.sequence - b.sequence).map((review) => this.renderQueueItem(review))}
          </div>
        ` : html`<div class="empty">没有开启中的窗口，下一次送审会自动开启新窗口。</div>`}

        <h3>等待队列（FIFO）</h3>
        ${waiting.length ? html`<div class="review-list">${waiting.map((review, index) => html`
          <article class="review-card">
            <div class="property-head">
              <strong>${index + 1}. ${review.componentName} · r${review.revision}</strong>
              <span class="pill review">队位 ${index + 1}</span>
            </div>
            <div class="muted">提交于 ${new Date(review.submittedAt).toLocaleString('zh-CN')}；窗口切换时未开始项按此顺序顺延。</div>
          </article>`)}</div>` : html`<p class="muted">队列为空。</p>`}

        ${activeReviews.length ? html`
          <h3 style="margin-top:14px">评审中（切换窗口后留在原窗口出结论）</h3>
          <div class="review-list">${activeReviews.map((review) => this.renderQueueItem(review))}</div>
        ` : nothing}

        <h3 style="margin-top:14px">发布快照（仅最终生效结论）</h3>
        <label class="field full">
          <select aria-label="选择发布窗口" .value=${selectedWindowId} @change=${(event: Event) => { this.snapshotWindowId = (event.currentTarget as HTMLSelectElement).value; }}>
            ${windows.map((item: ReviewWindow) => html`<option value=${item.id}>${item.label}${item.closedAt ? '（已关闭）' : '（进行中）'}</option>`)}
          </select>
        </label>
        ${snapshot ? html`
          ${snapshot.approved.length ? html`
            <div class="review-list">${snapshot.approved.map((entry) => html`
              <article class="review-card">
                <div class="property-head"><strong>${entry.componentName} · r${entry.revision}</strong><span class="pill published">生效</span></div>
                <div class="muted">通过于 ${new Date(entry.decidedAt).toLocaleString('zh-CN')}${entry.decideReason ? html` · ${entry.decideReason}` : ''}</div>
              </article>`)}</div>
            <details style="margin-top:8px"><summary class="linklike">查看快照 JSON</summary><pre>${JSON.stringify(snapshot, null, 2)}</pre></details>
            <sp-button size="s" variant="secondary" style="margin-top:8px" @click=${() => this.copy(JSON.stringify(snapshot, null, 2))}>复制快照 JSON</sp-button>
          ` : html`<p class="muted">该窗口尚无评审通过项，发布快照为空。驳回与排队内容不会进入快照。</p>`}
        ` : nothing}
      </section>
    `;
  }

  private renderQueueItem(review: ReviewItem): TemplateResult {
    return html`
      <article class="review-card">
        <div class="property-head">
          <strong>${review.componentName} · r${review.revision}</strong>
          <span class="pill ${review.status === 'approved' ? 'published' : review.status === 'rejected' ? 'draft' : 'review'}">${this.reviewBadgeLabel(review.status)}</span>
        </div>
        <div class="muted">提交于 ${new Date(review.submittedAt).toLocaleString('zh-CN')}${review.decidedAt ? html`；${new Date(review.decidedAt).toLocaleString('zh-CN')} 出结论` : ''}</div>
        ${review.decideReason ? html`<div class="muted">${review.decideReason}</div>` : nothing}
        ${review.status === 'active' ? html`
          <div class="inline" style="margin-top:6px;flex-wrap:wrap">
            <sp-button size="s" variant="accent" @click=${() => this.store.decideReview(review.id, true, '契约与无障碍说明核验通过。')}>通过</sp-button>
            <sp-button size="s" variant="secondary" @click=${() => {
              const reason = window.prompt('驳回原因（会保留在失败记录中）', '契约或无障碍说明不满足发布要求。');
              if (reason !== null) this.store.decideReview(review.id, false, reason || '评审未通过。');
            }}>驳回</sp-button>
          </div>` : nothing}
      </article>
    `;
  }

  private async copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.flash('代码已复制');
    } catch {
      this.flash('复制失败，请手动选择代码');
    }
  }

  private flash(message: string) {
    this.toast = message;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toast = ''; }, 3000);
  }
}

customElements.define('spec-a11y-workbench', SpecA11yWorkbench);
