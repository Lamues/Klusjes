const _v = new URLSearchParams(import.meta.url.split('?')[1]).get('v') || Date.now();
const { localize } = await import(`../utils/i18n.js?v=${_v}`);

export class TaskOrganizerSubtaskModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._taskId = null;
    this._task = null;
    this._hass = null;
    this._completionSubtasks = [];
  }

  localize(key, replace = null) {
    return localize(this._hass, key, replace);
  }

  open(taskId, task, hass) {
    this._taskId = taskId;
    this._task = task;
    this._hass = hass;
    this._completionSubtasks = JSON.parse(JSON.stringify(task.subtasks || []));

    this._render();
    this.shadowRoot.getElementById('subtask-completion-modal').classList.add('open');
  }

  _close() {
    this.shadowRoot.getElementById('subtask-completion-modal').classList.remove('open');
    this._taskId = null;
  }

  /** Escapes text that is put into the HTML of the list. */
  _esc(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _renderSubtaskList() {
    const container = this.shadowRoot.getElementById('sub-completion-list');
    if (!container) return;
    container.innerHTML = this._completionSubtasks.map((st, index) => `
        <button type="button" class="sub-row sub-complete-check ${st.done ? 'done' : ''}" data-index="${index}" role="checkbox" aria-checked="${st.done ? 'true' : 'false'}">
            <span class="sub-box"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 7.8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <span class="sub-title">${this._esc(st.title)}</span>
        </button>
    `).join('');

    container.querySelectorAll('.sub-row').forEach(row => {
        row.addEventListener('click', () => this._toggle(parseInt(row.dataset.index), row));
    });
    this._updateProgress();
  }

  /** Ticks or unticks one subtask without re-rendering the list (keeps the scroll position). */
  _toggle(index, row) {
    const st = this._completionSubtasks[index];
    if (!st) return;
    st.done = !st.done;
    row.classList.toggle('done', st.done);
    row.setAttribute('aria-checked', st.done ? 'true' : 'false');
    this._updateProgress();
  }

  _updateProgress() {
    const total = this._completionSubtasks.length;
    const done = this._completionSubtasks.filter(st => st.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const fill = this.shadowRoot.getElementById('sub-progress-fill');
    const label = this.shadowRoot.getElementById('sub-progress-label');
    if (fill) fill.style.width = `${pct}%`;
    if (label) label.textContent = this.localize('subtasks_progress', { done, total });
  }

  async _save() {
    if (!this._task) return;

    const allDone = this._completionSubtasks.every(st => st.done);
    
    await this._hass.callWS({
        type: 'task_organizer/edit_task',
        task_id: this._taskId,
        subtasks: this._completionSubtasks
    });

    if (allDone) {
        const taskIdToComplete = this._taskId;
        if (confirm(this.localize('confirm_task_complete'))) {
            this._close();
            this.dispatchEvent(new CustomEvent('proceed-to-assignee', { detail: { taskId: taskIdToComplete }, bubbles: true, composed: true }));
        } else {
            this._close();
            this.dispatchEvent(new CustomEvent('subtasks-saved', { bubbles: true, composed: true }));
        }
    } else {
        this._close();
        this.dispatchEvent(new CustomEvent('subtasks-saved', { bubbles: true, composed: true }));
    }
  }

  async _completeAll() {
    if (!this._task) return;
    
    const taskIdToComplete = this._taskId;
    const updatedSubtasks = this._completionSubtasks.map(st => ({ ...st, done: true }));

    await this._hass.callWS({
        type: 'task_organizer/edit_task',
        task_id: this._taskId,
        subtasks: updatedSubtasks
    });

    this._close();
    this.dispatchEvent(new CustomEvent('proceed-to-assignee', { detail: { taskId: taskIdToComplete }, bubbles: true, composed: true }));
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 5000; justify-content: center; align-items: flex-start; padding-top: 120px; padding-bottom: 24px; box-sizing: border-box; overflow-y: auto; }
        .modal.open { display: flex; }
        .modal-content { background: var(--card-background-color); color: var(--primary-text-color); padding: 24px; border-radius: var(--ha-dialog-border-radius, 28px); width: min(480px, calc(100% - 32px)); margin: 0 16px; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px; max-height: calc(100vh - 150px); overflow-y: auto; box-shadow: 0px 4px 16px rgba(0,0,0,0.5); }
        @media (max-width: 768px), (max-height: 768px) {
          .modal { padding-top: 16px; padding-bottom: 16px; }
          .modal-content { max-height: calc(100vh - 32px); }
        }
        @media (max-width: 768px) {
          .modal-content { padding: 16px; width: calc(100% - 32px); max-width: calc(100% - 32px); margin: 0 16px; }
        }
        h2 { margin: 0; font-size: 20px; font-weight: 500; line-height: 1.3; }
        .desc { margin: 0; font-size: 14px; color: var(--secondary-text-color); }
        .progress-wrap { display: flex; flex-direction: column; gap: 6px; }
        .progress-label { font-size: 13px; font-weight: 500; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
        .progress-track { height: 6px; border-radius: 3px; background: var(--divider-color); overflow: hidden; }
        .progress-fill { height: 100%; width: 0; border-radius: 3px; background: var(--success-color, #4caf50); transition: width 0.3s ease; }
        #sub-completion-list { display: flex; flex-direction: column; gap: 10px; }
        .sub-row { display: flex; align-items: center; gap: 16px; width: 100%; min-height: 64px; padding: 12px 16px; box-sizing: border-box; text-align: left; font-family: inherit; color: var(--primary-text-color); background: var(--secondary-background-color); border: 1px solid transparent; border-radius: var(--ha-card-border-radius, 12px); cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background-color 0.2s, border-color 0.2s, transform 0.1s; }
        .sub-row:active { transform: scale(0.985); }
        .sub-box { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--secondary-text-color); color: transparent; transition: background-color 0.2s, border-color 0.2s, color 0.2s; --mdc-icon-size: 22px; }
        .sub-title { flex: 1; min-width: 0; font-size: 18px; line-height: 1.3; word-break: break-word; transition: opacity 0.2s; }
        .sub-row.done { background: color-mix(in srgb, var(--success-color, #4caf50) 14%, var(--secondary-background-color)); border-color: color-mix(in srgb, var(--success-color, #4caf50) 40%, transparent); }
        .sub-row.done .sub-box { background: var(--success-color, #4caf50); border-color: var(--success-color, #4caf50); color: #fff; }
        .sub-row.done .sub-title { opacity: 0.65; text-decoration: line-through; }
        .footer { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
      </style>
      <div id="subtask-completion-modal" class="modal">
          <div class="modal-content">
              <h2 id="sub-completion-title">${this._esc(this._task ? this._task.name + ' - ' : '')}${this.localize('complete_subtasks')}</h2>
              <p class="desc">${this.localize('complete_subtasks_desc')}</p>
              <div class="progress-wrap">
                  <div class="progress-label" id="sub-progress-label"></div>
                  <div class="progress-track"><div class="progress-fill" id="sub-progress-fill"></div></div>
              </div>
              <div id="sub-completion-list"></div>
              <div class="footer">
                  <ha-button appearance="plain" variant="brand" id="btn-submodal-cancel">${this.localize('cancel')}</ha-button>
                  <div style="flex: 1;"></div>
                  <ha-button id="btn-submodal-save">${this.localize('save')}</ha-button>
                  <ha-button raised id="btn-submodal-all">${this.localize('all_done')}</ha-button>
              </div>
          </div>
      </div>
    `;

    this._renderSubtaskList();

    this.shadowRoot.getElementById('btn-submodal-cancel').addEventListener('click', () => this._close());
    this.shadowRoot.getElementById('btn-submodal-save').addEventListener('click', () => this._save());
    this.shadowRoot.getElementById('btn-submodal-all').addEventListener('click', () => this._completeAll());
  }
}
try { customElements.define('task-organizer-subtask-modal', TaskOrganizerSubtaskModal); } catch (e) { if (!e.message.includes('already been used')) { throw e; } }
