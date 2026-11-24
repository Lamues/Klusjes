const _v = new URLSearchParams(import.meta.url.split('?')[1]).get('v') || Date.now();
const { localize, renderCheckbox, renderSwitch } = await import(`../utils/i18n.js?v=${_v}`);
const { nextOccurrence, toYMD, weekdaysOf } = await import(`../utils/schedule.js?v=${_v}`);
const { getEffectiveAssignees } = await import(`../utils/assignees.js?v=${_v}`);

export class TaskOrganizerTaskModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._editingTaskId = null;
    this._task = null;
    this._users = {};
    this._hass = null;
    this._templates = {};
    this._subtasks = [];
    this._currentTaskImages = [];
    this._currentIcon = "mdi:broom";
    this._previousInterval = 7;
    this._isOnetime = false;
    this._dueOverride = null;       // 'YYYY-MM-DD' of the manually chosen next due date
    this._dueOverrideAuto = false;  // true when the date came from changing the schedule, not from the picker
  }

  localize(key, replace = null) {
    return localize(this._hass, key, replace);
  }

  open(taskId, task, templates, users, hass) {
    this._editingTaskId = taskId;
    this._task = task;
    this._templates = templates || {};
    this._users = users;
    this._hass = hass;
    this._subtasks = [];
    this._currentTaskImages = [];
    
    this._render();
    
    const modal = this.shadowRoot.getElementById('task-modal');
    if (taskId && this._task) {
        const t = this._task;
        if (this.shadowRoot.getElementById('f-name')) this.shadowRoot.getElementById('f-name').value = t.name;
        if (this.shadowRoot.getElementById('f-description')) this.shadowRoot.getElementById('f-description').value = t.description || "";
        if (this.shadowRoot.getElementById('f-area')) this.shadowRoot.getElementById('f-area').value = t.area || "";
        const taskInterval = (t.interval !== undefined && t.interval !== null) ? parseInt(t.interval) : 7;
        const isOnetime = taskInterval === 0;
        this._previousInterval = !isOnetime ? taskInterval : 7;
        if (this.shadowRoot.getElementById('f-interval')) {
            this.shadowRoot.getElementById('f-interval').value = taskInterval;
        }
        if (this.shadowRoot.getElementById('f-complexity')) this.shadowRoot.getElementById('f-complexity').value = t.complexity;
        this._subtasks = t.subtasks ? [...t.subtasks] : [];
        this._currentTaskImages = t.images ? t.images.map(img => {
            if (typeof img === 'string') {
                return { url: img, name: img.split('/').pop() };
            }
            return img;
        }) : [];
        this._currentIcon = t.icon || "mdi:broom";
        
        this.shadowRoot.querySelectorAll('.assignee-cb').forEach(cb => {
            cb.checked = t.assignees && t.assignees.includes(cb.value);
        });
        this._refreshCurrentAssigneeUI(getEffectiveAssignees(t)[0]);
        
        this._loadScheduleIntoForm(t.schedule);
        this._updateTaskTypeUI(isOnetime);
        this.shadowRoot.getElementById('template-suggestions').style.display = 'none';
        
        const now = new Date();
        now.setHours(0, 0, 0, 0); 

        if (t.paused_until && new Date(t.paused_until) >= now) {
            this.shadowRoot.getElementById('f-pause-cb').checked = true;
            this.shadowRoot.getElementById('f-pause-date').value = t.paused_until;
            this.shadowRoot.getElementById('f-pause-date').style.display = '';
        } else {
            this.shadowRoot.getElementById('f-pause-cb').checked = false;
            this.shadowRoot.getElementById('f-pause-date').value = "";
            this.shadowRoot.getElementById('f-pause-date').style.display = 'none';
        }

        if (t.active_months && t.active_months.length > 0) {
            this.shadowRoot.getElementById('f-restrict-months-cb').checked = true;
            this.shadowRoot.getElementById('f-months-band').style.display = 'flex';
            this.shadowRoot.querySelectorAll('#f-months-band .month-pill').forEach(p => {
                if (t.active_months.includes(parseInt(p.dataset.month))) {
                    p.classList.add('selected');
                    p.style.background = 'var(--primary-color)';
                    p.style.color = 'var(--text-primary-color)';
                } else {
                    p.classList.remove('selected');
                    p.style.background = 'var(--secondary-background-color, #e0e0e0)';
                    p.style.color = 'var(--primary-text-color)';
                }
            });
        } else {
            this.shadowRoot.getElementById('f-restrict-months-cb').checked = false;
            this.shadowRoot.getElementById('f-months-band').style.display = 'none';
            this.shadowRoot.querySelectorAll('#f-months-band .month-pill').forEach(p => {
                p.classList.remove('selected');
                p.style.background = 'var(--secondary-background-color, #e0e0e0)';
                p.style.color = 'var(--primary-text-color)';
            });
        }
    } else {
        this.shadowRoot.getElementById('f-name').value = ""; 
        this.shadowRoot.getElementById('f-description').value = "";
        this.shadowRoot.getElementById('f-area').value = "";
        this.shadowRoot.getElementById('f-interval').value = 7;
        this.shadowRoot.getElementById('f-complexity').value = 5; 
        this._currentIcon = "mdi:broom";
        this._subtasks = [];
        this._previousInterval = 7;
        
        this._loadScheduleIntoForm(null);
        this._updateTaskTypeUI(false); 
        this.shadowRoot.getElementById('template-suggestions').style.display = 'block';
        this.shadowRoot.getElementById('template-suggestions').innerHTML = '';
        this.shadowRoot.querySelectorAll('.assignee-cb').forEach(cb => cb.checked = false);        
        this._refreshCurrentAssigneeUI(null);

        this.shadowRoot.getElementById('f-pause-cb').checked = false;
        this.shadowRoot.getElementById('f-pause-date').value = "";
        this.shadowRoot.getElementById('f-pause-date').style.display = 'none';

        this.shadowRoot.getElementById('f-restrict-months-cb').checked = false;
        this.shadowRoot.getElementById('f-months-band').style.display = 'none';
        this.shadowRoot.querySelectorAll('#f-months-band .month-pill').forEach(p => {
            p.classList.remove('selected');
            p.style.background = 'var(--secondary-background-color, #e0e0e0)';
            p.style.color = 'var(--primary-text-color)';
        });

        this.shadowRoot.getElementById('f-override-overdue-cb').checked = false;
        this.shadowRoot.getElementById('f-override-overdue-days').value = "";
        this.shadowRoot.getElementById('f-override-overdue-days').style.display = 'none';
    }
    
    // Nothing is changed about the next due date unless a date is picked (or the schedule is changed)
    this._dueOverride = null;
    this._dueOverrideAuto = false;
    const dueInput = this.shadowRoot.getElementById('f-custom-due-date');
    if (dueInput) dueInput.value = "";
    this._refreshDueInfo();

    const overrideOverdueCb = this.shadowRoot.getElementById('f-override-overdue-cb');
    const overrideOverdueDays = this.shadowRoot.getElementById('f-override-overdue-days');
    if (taskId && this._task) {
        const t = this._task;
        if (t.override_overdue_days !== null && t.override_overdue_days !== undefined) {
            overrideOverdueCb.checked = true;
            overrideOverdueDays.value = t.override_overdue_days;
            overrideOverdueDays.style.display = '';
        } else {
            overrideOverdueCb.checked = false;
            overrideOverdueDays.style.display = 'none';
        }
    }

    this.shadowRoot.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    this.shadowRoot.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const firstTab = this.shadowRoot.querySelector('.tab-btn[data-tab="tab-general"]');
    const firstContent = this.shadowRoot.querySelector('#tab-general');
    if (firstTab) firstTab.classList.add('active');
    if (firstContent) firstContent.classList.add('active');

    this._renderModalSubtasks();
    this._renderImageGallery();
    this._loadTaskHistory(taskId);

    const picker = this.shadowRoot.getElementById('f-icon-picker');
    if (picker) {
      picker.hass = this._hass;
      picker.value = this._currentIcon; 
    }

    const btnDelete = this.shadowRoot.getElementById('btn-modal-delete');
    if (btnDelete) {
      btnDelete.style.display = taskId ? '' : 'none';
    }
    
    modal.classList.add('open');
    const tabsScroll = this.shadowRoot.getElementById('tabs-scroll');
    if (tabsScroll) tabsScroll.scrollLeft = 0;
    requestAnimationFrame(() => this._updateTabScrollIndicators());
    setTimeout(() => this._updateTabScrollIndicators(), 50);
    setTimeout(() => this._updateTabScrollIndicators(), 200);
  }

  /**
   * Confirms and dispatches the task deletion event, then closes the modal.
   */
  _deleteTask() {
    if (!this._editingTaskId) return;
    if (confirm(this.localize('confirm_delete'))) {
      const taskId = this._editingTaskId;
      this._close();
      this.dispatchEvent(new CustomEvent('task-deleted', {
        detail: { taskId, confirmed: true },
        bubbles: true,
        composed: true
      }));
    }
  }

  _close() {
    this.shadowRoot.getElementById('task-modal').classList.remove('open');
  }

  /** Locale used for weekday and month names. */
  _scheduleLocale() {
    return this._hass?.language || 'en';
  }

  /** Short weekday names as pills, Monday (0) first. */
  _weekdayPillsHtml() {
    const lang = this._scheduleLocale();
    // 1 January 2024 was a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const name = new Date(2024, 0, 1 + i).toLocaleDateString(lang, { weekday: 'short' });
      return `<div class="pill weekday-pill" data-day="${i}" role="button" tabindex="0">${name}</div>`;
    }).join('');
  }

  _getSelectedWeekdays() {
    return Array.from(this.shadowRoot.querySelectorAll('#f-schedule-weekdays .weekday-pill.selected'))
      .map(p => parseInt(p.dataset.day)).sort((a, b) => a - b);
  }

  _setSelectedWeekdays(days) {
    this.shadowRoot.querySelectorAll('#f-schedule-weekdays .weekday-pill').forEach(p => {
      p.classList.toggle('selected', days.includes(parseInt(p.dataset.day)));
    });
  }

  /** Fills the month select: all 12 months for yearly, month groups for quarterly and half-yearly. */
  _fillScheduleMonthOptions(type) {
    const select = this.shadowRoot.getElementById('f-schedule-month');
    const label = this.shadowRoot.getElementById('f-schedule-month-label');
    if (!select) return;
    const lang = this._scheduleLocale();
    const monthName = (m, style) => new Date(2024, m - 1, 1).toLocaleDateString(lang, { month: style });
    if (type === 'quarterly' || type === 'halfyearly') {
      const step = type === 'quarterly' ? 3 : 6;
      const groups = step; // 3 groups of 4 months, or 6 groups of 2 months
      select.innerHTML = Array.from({ length: groups }, (_, k) => k + 1).map(k =>
        `<option value="${k}">${Array.from({ length: 12 / step }, (_, j) => monthName(k + j * step, 'short')).join(' / ')}</option>`
      ).join('');
      if (label) label.textContent = this.localize(type === 'quarterly' ? 'quarter_months_lbl' : 'half_year_months_lbl');
    } else {
      select.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${monthName(i + 1, 'long')}</option>`).join('');
      if (label) label.textContent = this.localize('month_lbl');
    }
  }

  /** Puts a stored schedule (or none) into the form controls. */
  _loadScheduleIntoForm(schedule) {
    const type = schedule?.type || 'interval';
    const typeSelect = this.shadowRoot.getElementById('f-schedule-type');
    if (!typeSelect) return;
    typeSelect.value = type;
    this._fillScheduleMonthOptions(type);
    this._setSelectedWeekdays(type === 'weekly' ? weekdaysOf(schedule) : []);
    this.shadowRoot.getElementById('f-schedule-month').value = String(schedule?.month ?? 1);
    this.shadowRoot.getElementById('f-schedule-day').value = schedule?.day ?? 1;
    this._refreshScheduleUI();
  }

  /** Reads the form into a schedule object, or null when the plain interval is used. */
  _readSchedule() {
    const type = this.shadowRoot.getElementById('f-schedule-type')?.value || 'interval';
    if (type === 'interval') return null;
    if (type === 'weekly') return { type, weekdays: this._getSelectedWeekdays() };
    const day = Math.min(31, Math.max(1, parseInt(this.shadowRoot.getElementById('f-schedule-day').value) || 1));
    if (type === 'monthly') return { type, day };
    return { type, day, month: parseInt(this.shadowRoot.getElementById('f-schedule-month').value) || 1 };
  }

  /** Compares two schedules (null = plain interval). */
  _sameSchedule(a, b) {
    const norm = (x) => {
      if (!x || !x.type) return null;
      if (x.type === 'weekly') return JSON.stringify({ type: 'weekly', weekdays: [...weekdaysOf(x)].sort((p, q) => p - q) });
      return JSON.stringify({ type: x.type, day: Number(x.day), month: x.month === undefined ? null : Number(x.month) });
    };
    return norm(a) === norm(b);
  }

  /** Shows only the controls that belong to the chosen repeat mode. */
  _refreshScheduleUI() {
    const type = this.shadowRoot.getElementById('f-schedule-type')?.value || 'interval';
    const show = (id, visible) => {
      const el = this.shadowRoot.getElementById(id);
      if (el) el.style.display = visible ? '' : 'none';
    };
    show('f-schedule-block', !this._isOnetime);
    show('f-schedule-weekday-row', type === 'weekly');
    show('f-schedule-month-row', type === 'quarterly' || type === 'halfyearly' || type === 'yearly');
    show('f-schedule-day-row', type !== 'interval' && type !== 'weekly');

    // With a fixed schedule the "days" field is not used. Its value is kept for switching back.
    const intervalField = this.shadowRoot.getElementById('f-interval');
    if (intervalField && !this._isOnetime) intervalField.disabled = (type !== 'interval');
  }

  /**
   * Called when a schedule control changes: updates the visible controls and, when the
   * schedule differs from the saved one, proposes the first scheduled day as next due date.
   * A date that was picked by hand is never replaced.
   */
  _onScheduleChanged(e) {
    const type = this.shadowRoot.getElementById('f-schedule-type')?.value || 'interval';
    if (e?.target?.id === 'f-schedule-type') {
      this._fillScheduleMonthOptions(type);
      if (type === 'weekly' && this._getSelectedWeekdays().length === 0) {
        this._setSelectedWeekdays([(new Date().getDay() + 6) % 7]); // start with today's weekday
      }
    }
    this._refreshScheduleUI();

    if (!this._dueOverride || this._dueOverrideAuto) {
      const schedule = this._readSchedule();
      const usable = schedule && (schedule.type !== 'weekly' || schedule.weekdays.length > 0);
      const changed = !this._editingTaskId || !this._sameSchedule(schedule, this._task?.schedule);
      const next = (usable && changed) ? nextOccurrence(schedule, new Date(), true) : null;
      this._dueOverride = next ? toYMD(next) : null;
      this._dueOverrideAuto = !!next;
      this._refreshDueInfo();
    }
  }

  /** Text for the "next due date" line in the time tab. */
  _refreshDueInfo() {
    const info = this.shadowRoot.getElementById('f-next-due-info');
    const resetBtn = this.shadowRoot.getElementById('f-reset-due-btn');
    if (!info) return;
    const lang = this._scheduleLocale();
    const fmt = (d) => d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    let date = null;
    let manual = false;
    if (this._dueOverride) {
      const [y, m, d] = this._dueOverride.split('-').map(Number);
      date = new Date(y, m - 1, d);
      manual = !this._dueOverrideAuto;
    } else if (this._editingTaskId && this._task?.due_date) {
      const stored = new Date(this._task.due_date);
      if (!isNaN(stored)) date = new Date(stored.getFullYear(), stored.getMonth(), stored.getDate());
    } else {
      date = new Date();
      const schedule = this._readSchedule();
      if (schedule && (schedule.type !== 'weekly' || schedule.weekdays.length > 0)) date = nextOccurrence(schedule, new Date(), true) || date;
    }

    info.textContent = date ? fmt(date) : '';
    if (resetBtn) resetBtn.style.display = manual ? '' : 'none';
  }

  /** Remembers a date picked with the calendar. */
  _onDuePicked(value) {
    if (!value) return;
    this._dueOverride = value;
    this._dueOverrideAuto = false;
    this._refreshDueInfo();
  }

  /** Forgets the manually chosen date. */
  _resetDueOverride() {
    this._dueOverride = null;
    this._dueOverrideAuto = false;
    const dueInput = this.shadowRoot.getElementById('f-custom-due-date');
    if (dueInput) dueInput.value = '';
    // Falls back to the proposal of a changed schedule, if there is one
    this._onScheduleChanged();
    this._refreshDueInfo();
  }

  /**
   * Fills the "current assignee" select with the ticked assignees. The row is only
   * shown when two or more people are ticked (that is when the task rotates).
   * @param {string|null} preferredUid - User to preselect.
   */
  _refreshCurrentAssigneeUI(preferredUid) {
    const row = this.shadowRoot.getElementById('f-current-assignee-row');
    const select = this.shadowRoot.getElementById('f-current-assignee');
    if (!row || !select) return;
    const ticked = Array.from(this.shadowRoot.querySelectorAll('.assignee-cb'))
      .filter(cb => cb.checked).map(cb => cb.value);
    if (ticked.length < 2) {
      row.style.display = 'none';
      select.innerHTML = '';
      return;
    }
    const keep = preferredUid || select.value;
    select.innerHTML = ticked.map(uid => `<option value="${uid}">${this._users[uid] || uid}</option>`).join('');
    select.value = ticked.includes(keep) ? keep : ticked[0];
    row.style.display = '';
  }

  /**
   * Updates the UI elements based on whether the task is one-time or recurring.
   * Preserves previous interval value when toggling back to recurring.
   * @param {boolean} isOnetime - Whether the task is configured as a one-time task.
   */
  _updateTaskTypeUI(isOnetime) {
    this._isOnetime = isOnetime;
    const intervalField = this.shadowRoot.getElementById('f-interval');
    const btnOnetime = this.shadowRoot.getElementById('btn-type-onetime');
    const btnRecurring = this.shadowRoot.getElementById('btn-type-recurring');
    const selector = this.shadowRoot.querySelector('.task-type-selector');

    if (isOnetime) {
        if (intervalField) {
            const currentVal = parseInt(intervalField.value);
            if (!isNaN(currentVal) && currentVal > 0) {
                this._previousInterval = currentVal;
            }
            intervalField.disabled = true;
            intervalField.value = 0;
        }
        if (btnOnetime) btnOnetime.classList.add('active');
        if (btnRecurring) btnRecurring.classList.remove('active');
        if (selector) selector.setAttribute('data-active', 'onetime');
    } else {
        if (intervalField) {
            intervalField.disabled = false;
            const restoreVal = (this._previousInterval && this._previousInterval > 0) ? this._previousInterval : 7;
            intervalField.value = restoreVal;
        }
        if (btnOnetime) btnOnetime.classList.remove('active');
        if (btnRecurring) btnRecurring.classList.add('active');
        if (selector) selector.setAttribute('data-active', 'recurring');
    }
    this._refreshScheduleUI();
  }

  _handleTemplateSuggestions(e) {
    const input = e.target.value.toLowerCase();
    const suggestionsContainer = this.shadowRoot.getElementById('template-suggestions');
    suggestionsContainer.innerHTML = '';

    if (this._editingTaskId || input.length < 3) {
        return;
    }

    const matchingTemplates = Object.values(this._templates).filter(t => 
        t.name.toLowerCase().includes(input)
    );

    if (matchingTemplates.length > 0) {
        matchingTemplates.slice(0, 5).forEach(template => {
            const suggestionEl = document.createElement('button');
            suggestionEl.className = 'suggestion-item';
            suggestionEl.dataset.id = template.id;
            suggestionEl.textContent = this.localize('recreate_task_prompt', { taskName: template.name });
            suggestionEl.addEventListener('click', () => this._applyTemplate(template.id));
            suggestionsContainer.appendChild(suggestionEl);
        });
    }
  }

  _applyTemplate(templateId) {
    if (templateId && this._templates[templateId]) {
        const t = this._templates[templateId];
        this.shadowRoot.getElementById('f-name').value = t.name;
        this.shadowRoot.getElementById('f-description').value = t.description || '';
        this.shadowRoot.getElementById('f-area').value = t.area || '';
        this.shadowRoot.getElementById('f-complexity').value = t.complexity || 5;
        this.shadowRoot.getElementById('f-icon-picker').value = t.icon || 'mdi:broom';
        this.shadowRoot.getElementById('template-suggestions').innerHTML = '';
        
        this._subtasks = t.subtasks ? JSON.parse(JSON.stringify(t.subtasks)) : [];
        this._renderModalSubtasks();

        const tmplInterval = (t.interval !== undefined && t.interval !== null) ? parseInt(t.interval) : 7;
        const isOnetimeSelected = this._isOnetime ?? this.shadowRoot.getElementById('btn-type-onetime')?.classList.contains('active');
        if (isOnetimeSelected) {
            this.shadowRoot.getElementById('f-interval').value = 0;
            this._previousInterval = tmplInterval > 0 ? tmplInterval : 7;
        } else {
            const intVal = tmplInterval > 0 ? tmplInterval : 7;
            this.shadowRoot.getElementById('f-interval').value = intVal;
            this._previousInterval = intVal;
        }

        this.shadowRoot.querySelectorAll('.assignee-cb').forEach(cb => {
            cb.checked = t.assignees && t.assignees.includes(cb.value);
        });
        this._refreshCurrentAssigneeUI(null);
    }
  }

  _addSubtask() {
    const input = this.shadowRoot.getElementById('new-subtask-title');
    const title = input.value.trim();
    if (!title) return;
    
    this._subtasks.push({ title: title, done: false });
    input.value = '';
    this._renderModalSubtasks();
  }

  _removeSubtask(index) {
    this._subtasks.splice(index, 1);
    this._renderModalSubtasks();
  }

  _toggleSubtaskStatus(index) {
    this._subtasks[index].done = !this._subtasks[index].done;
    this._renderModalSubtasks();
  }

  _renderModalSubtasks() {
    const container = this.shadowRoot.getElementById('subtask-list');
    if (!container) return;
    
    if (this._subtasks.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = this._subtasks.map((st, index) => `
        <div style="display: flex; align-items: center; gap: 8px; background: var(--secondary-background-color); padding: 4px 8px; border-radius: 4px;">
            <ha-checkbox class="subtask-check" data-index="${index}" ${st.done ? 'checked' : ''}></ha-checkbox>
            <span style="flex: 1; font-size: 14px; ${st.done ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${st.title}</span>
            <button class="action-btn btn-del-subtask" data-index="${index}" style="width: 30px; height: 30px; background: transparent; border: none; cursor: pointer; color: var(--secondary-text-color);">
                <ha-icon icon="mdi:close" style="--mdc-icon-size: 18px;"></ha-icon>
            </button>
        </div>
    `).join('');

    container.querySelectorAll('.subtask-check').forEach(cb => {
        cb.addEventListener('change', (e) => this._toggleSubtaskStatus(parseInt(e.target.dataset.index)));
    });
    container.querySelectorAll('.btn-del-subtask').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._removeSubtask(parseInt(e.currentTarget.dataset.index));
        });
    });
  }

  _updateTabScrollIndicators() {
      const tabs = this.shadowRoot.getElementById('tabs-scroll');
      const leftBtn = this.shadowRoot.getElementById('scroll-left');
      const rightBtn = this.shadowRoot.getElementById('scroll-right');
      if (!tabs || !leftBtn || !rightBtn) return;
      
      const isScrollable = tabs.scrollWidth > tabs.clientWidth + 1;
      const isAtStart = tabs.scrollLeft <= 1;
      const isAtEnd = Math.ceil(tabs.scrollLeft + tabs.clientWidth) >= tabs.scrollWidth - 1;
      
      if (isScrollable) {
          leftBtn.style.display = isAtStart ? 'none' : 'flex';
          rightBtn.style.display = isAtEnd ? 'none' : 'flex';
      } else {
          leftBtn.style.display = 'none';
          rightBtn.style.display = 'none';
      }
  }

  _loadTaskHistory(taskId) {
    const container = this.shadowRoot.getElementById('f-history-container');
    if (!container) return;
    
    if (!taskId) {
        container.innerHTML = `<div style="text-align: center; color: var(--secondary-text-color); padding: 16px;">${this.localize('no_history')}</div>`;
        return;
    }
    
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; color: var(--secondary-text-color);">
            <ha-circular-progress active size="medium"></ha-circular-progress>
            <div style="margin-top: 8px; font-size: 14px;">Lade Historie...</div>
        </div>
    `;
    
    this._hass.callWS({
        type: 'task_organizer/get_task_audit_log',
        task_id: taskId
    }).then(response => {
        this._renderAuditLog(container, response.history || []);
    }).catch(err => {
        console.error("Error loading task history:", err);
        container.innerHTML = `<div style="text-align: center; color: var(--error-color); padding: 16px;">Fehler beim Laden der Historie</div>`;
    });
  }

  _renderAuditLog(container, taskHistory) {
    if (taskHistory.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--secondary-text-color); padding: 16px;">${this.localize('no_history')}</div>`;
        return;
    }
    
    let html = '<div class="history-timeline">';
    taskHistory.forEach(entry => {
        const dateStr = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Unbekannt';
        const userName = entry.user_id && this._users ? (this._users[entry.user_id] || entry.user_id) : 'Unbekannt';
        
        let title = '';
        let detailsHtml = '';
        let icon = '';
        let color = '';
        
        if (entry.action === 'created') {
            title = 'Aufgabe erstellt';
            icon = 'mdi:plus-circle';
            color = 'var(--info-color, #2196f3)';
        } else if (entry.action === 'edited') {
            title = 'Aufgabe bearbeitet';
            icon = 'mdi:text-box-edit-outline';
            color = 'var(--primary-color, #03a9f4)';
            
            const keyMap = {
                'name': 'Name', 'description': 'Beschreibung', 'area': 'Bereich',
                'interval': 'Intervall', 'assignees': 'Bearbeiter', 'complexity': 'Punkte',
                'category': 'Kategorie', 'icon': 'Icon', 'subtasks': 'Unteraufgaben',
                'images': 'Bilder', 'due_date': 'Fälligkeitsdatum', 'paused_until': 'Pausiert bis',
                'override_overdue_days': 'Überfälligkeit (Tage)', 'current_assignee': 'Aktueller Bearbeiter'
            };
            
            const changes = entry.details?.changes;
            if (changes && Object.keys(changes).length > 0) {
                detailsHtml = '<div style="margin-top: 8px; font-size: 12px; background: rgba(0,0,0,0.1); padding: 6px; border-radius: 4px;">';
                for (const [key, diff] of Object.entries(changes)) {
                    const translatedKey = keyMap[key] || key;
                    if (key === 'subtasks') {
                        const oldSubtasks = diff.old || [];
                        const newSubtasks = diff.new || [];
                        let completedSubtasks = [];
                        let addedSubtasks = [];
                        
                        newSubtasks.forEach(st => {
                            const oldSt = oldSubtasks.find(o => o.title === st.title);
                            if (oldSt) {
                                if (st.done && !oldSt.done) {
                                    completedSubtasks.push(st.title);
                                }
                            } else {
                                addedSubtasks.push(st.title);
                            }
                        });
                        
                        if (completedSubtasks.length > 0 || addedSubtasks.length > 0) {
                            if (completedSubtasks.length > 0) {
                                completedSubtasks.forEach(stTitle => {
                                    detailsHtml += `<div style="margin-bottom: 2px; color: var(--success-color, #4caf50);">• <b>Unteraufgabe:</b> <s>${stTitle}</s> abgeschlossen <ha-icon icon="mdi:check-circle" style="--mdc-icon-size: 12px; margin-left: 2px;"></ha-icon></div>`;
                                });
                                if (Object.keys(changes).length === 1 && addedSubtasks.length === 0) {
                                    title = userName !== 'Unbekannt' ? `${userName} hat Unteraufgaben abgeschlossen` : 'Unteraufgaben abgeschlossen';
                                    icon = 'mdi:check-circle-outline';
                                    color = 'var(--success-color, #4caf50)';
                                }
                            }
                            if (addedSubtasks.length > 0) {
                                addedSubtasks.forEach(stTitle => {
                                    detailsHtml += `<div style="margin-bottom: 2px;">• <b>Unteraufgabe:</b> ${stTitle} hinzugefügt</div>`;
                                });
                            }
                        } else {
                            detailsHtml += `<div style="margin-bottom: 2px;">• <b>${translatedKey}</b> geändert</div>`;
                        }
                    } else if (key === 'images' || key === 'assignees' || key === 'current_assignee') {
                        detailsHtml += `<div style="margin-bottom: 2px;">• <b>${translatedKey}</b> geändert</div>`;
                    } else {
                        const oldVal = diff.old !== null ? String(diff.old) : 'leer';
                        const newVal = diff.new !== null ? String(diff.new) : 'leer';
                        detailsHtml += `<div style="margin-bottom: 2px;">• <b>${translatedKey}</b>: <s>${oldVal}</s> → ${newVal}</div>`;
                    }
                }
                detailsHtml += '</div>';
            }
        } else if (entry.action === 'completed') {
            const usersWithPoints = entry.details?.users_with_points;
            if (usersWithPoints && Object.keys(usersWithPoints).length > 1) {
                title = 'Aufgabe gemeinsam abgeschlossen';
                let usersListHtml = '';
                for (const [uId, pts] of Object.entries(usersWithPoints)) {
                    const uName = this._users && this._users[uId] ? this._users[uId] : uId;
                    usersListHtml += `<div style="margin-bottom: 2px;">• <b>${uName}</b>: +${pts} Punkte</div>`;
                }
                detailsHtml = `<div style="margin-top: 8px; font-size: 12px; background: rgba(0,0,0,0.1); padding: 6px; border-radius: 4px;">${usersListHtml}</div>`;
            } else {
                title = userName !== 'Unbekannt' ? `${userName} hat die Aufgabe abgeschlossen` : 'Aufgabe abgeschlossen';
                if (entry.details?.points) {
                    detailsHtml = `<div class="timeline-points" style="color: var(--success-color, #4caf50)">+${entry.details.points} Punkte</div>`;
                }
            }
            icon = 'mdi:check-circle';
            color = 'var(--success-color, #4caf50)';
        } else {
            title = 'Aktion: ' + entry.action;
            icon = 'mdi:information';
            color = 'var(--secondary-text-color)';
        }
        
        html += `
            <div class="timeline-item" style="display: flex; gap: 16px; position: relative; padding-bottom: 16px;">
                <div class="timeline-marker" style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--card-background-color); display: flex; align-items: center; justify-content: center; z-index: 1; background-color: ${color}; flex-shrink: 0;">
                    <ha-icon icon="${icon}" style="--mdc-icon-size: 16px; color: white;"></ha-icon>
                </div>
                <div class="timeline-content" style="flex: 1; min-width: 0;">
                    <div class="timeline-date" style="font-size: 11px; color: var(--secondary-text-color); margin-bottom: 4px;">${dateStr}${userName !== 'Unbekannt' ? ' • ' + userName : ''}</div>
                    <div class="timeline-title" style="font-size: 14px; font-weight: 500; color: var(--primary-text-color);">${title}</div>
                    ${detailsHtml}
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
  }

  _renderImageGallery() {
      const gallery = this.shadowRoot.getElementById('f-images-gallery');
      const dropzoneText = this.shadowRoot.getElementById('f-image-dropzone-text');
      if (!gallery) return;
      if (!this._currentTaskImages || this._currentTaskImages.length === 0) {
          gallery.innerHTML = '';
          if (dropzoneText) dropzoneText.style.display = 'flex';
          return;
      }
      if (dropzoneText) dropzoneText.style.display = 'none';
      gallery.innerHTML = this._currentTaskImages.map((imgObj, index) => {
          const url = typeof imgObj === 'string' ? imgObj : imgObj.url;
          const name = typeof imgObj === 'string' ? url.split('/').pop() : (imgObj.name || url.split('/').pop());
          const isImage = /\.(jpeg|jpg|gif|png|webp|svg|bmp)$/i.test(url);
          
          if (isImage) {
              return `
                  <div class="image-preview" title="${name}" style="position: relative; width: 60px; height: 60px; border-radius: 4px; overflow: hidden; border: 1px solid var(--divider-color); cursor: pointer;">
                      <img src="${url}" style="width: 100%; height: 100%; object-fit: cover;">
                      <button class="image-delete-btn" data-index="${index}" style="position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer;"><ha-icon icon="mdi:close" style="--mdc-icon-size: 14px;"></ha-icon></button>
                  </div>
              `;
          } else {
              return `
                  <div class="image-preview file-preview" title="${name}" style="position: relative; width: 60px; height: 60px; border-radius: 4px; overflow: hidden; border: 1px solid var(--divider-color); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--secondary-background-color);">
                      <ha-icon icon="mdi:file-document-outline" style="--mdc-icon-size: 32px; color: var(--primary-color);"></ha-icon>
                      <span style="font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; text-align: center; margin-top: 4px;">${name}</span>
                      <button class="image-delete-btn" data-index="${index}" style="position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer;"><ha-icon icon="mdi:close" style="--mdc-icon-size: 14px;"></ha-icon></button>
                  </div>
              `;
          }
      }).join('');
      
      gallery.querySelectorAll('.image-preview').forEach((preview, index) => {
          preview.addEventListener('click', (e) => {
              if (!e.target.closest('.image-delete-btn')) {
                  const url = typeof this._currentTaskImages[index] === 'string' ? this._currentTaskImages[index] : this._currentTaskImages[index].url;
                  window.open(url, '_blank');
              }
          });
      });
      gallery.querySelectorAll('.image-delete-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const idx = e.currentTarget.dataset.index;
              this._currentTaskImages.splice(idx, 1);
              this._renderImageGallery();
          });
      });
  }

  async _handleImageSelection(e) {
      const targetInput = e.target;
      const files = Array.from(targetInput.files || []);
      if (!files.length) return;
      
      for (const file of files) {
          try {
              let blob = file;
              if (file.type.startsWith('image/')) {
                  blob = await this._resizeImage(file, 500);
              }
              const response = await this._uploadImage(blob, file.name);
              if (response && response.url) {
                  if (!this._currentTaskImages) this._currentTaskImages = [];
                  this._currentTaskImages.push({ url: response.url, name: response.name || file.name });
              }
          } catch (err) {
              console.error("TaskOrganizer: Image upload error", err);
              this.dispatchEvent(new CustomEvent('show-toast', { detail: { message: "Fehler beim Hochladen: " + err.message }, bubbles: true, composed: true }));
          }
      }
      
      if (targetInput && targetInput.value !== undefined) {
          targetInput.value = ''; 
      }
      this._renderImageGallery();
  }

  _resizeImage(file, maxSize) {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
              const img = new Image();
              img.onload = () => {
                  let width = img.width;
                  let height = img.height;
                  if (width > maxSize || height > maxSize) {
                      if (width > height) {
                          height = Math.round((height * maxSize) / width);
                          width = maxSize;
                      } else {
                          width = Math.round((width * maxSize) / height);
                          height = maxSize;
                      }
                  }
                  const canvas = document.createElement('canvas');
                  canvas.width = width;
                  canvas.height = height;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0, width, height);
                  canvas.toBlob((blob) => {
                      resolve(blob);
                  }, 'image/jpeg', 0.85);
              };
              img.onerror = () => reject(new Error("Failed to load image for resizing"));
              img.src = e.target.result;
          };
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsDataURL(file);
      });
  }

  async _uploadImage(blob, originalName) {
      const formData = new FormData();
      formData.append("image", blob, originalName || "upload.jpg");
      
      const response = await fetch("/api/task_organizer/upload", {
          method: "POST",
          headers: {
              authorization: `Bearer ${this._hass.auth.accessToken}`
          },
          body: formData
      });
      
      if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success && data.url) {
          return data;
      } else {
          throw new Error(data.message || "Unknown error from server");
      }
  }

  _saveTask() {
    const name = this.shadowRoot.getElementById('f-name')?.value?.trim();
    if (!name) {
        this.dispatchEvent(new CustomEvent('show-toast', { detail: { message: "Name ist erforderlich!" }, bubbles: true, composed: true }));
        return;
    }

    const assignees = [];
    const isOnetime = this._isOnetime ?? (this.shadowRoot.getElementById('btn-type-onetime')?.classList.contains('active') || false);
    this.shadowRoot.querySelectorAll('.assignee-cb').forEach(cb => {
        if (cb.checked) assignees.push(cb.value);
    });
    
    // Only a date that was picked (or proposed by a changed schedule) is sent. Otherwise the due date stays untouched.
    const customDueDate = this._dueOverride || null;

    const schedule = isOnetime ? null : this._readSchedule();
    if (schedule && schedule.type === 'weekly' && schedule.weekdays.length === 0) {
        this.dispatchEvent(new CustomEvent('show-toast', { detail: { message: this.localize('weekday_required') }, bubbles: true, composed: true }));
        return;
    }
    const currentAssigneeRow = this.shadowRoot.getElementById('f-current-assignee-row');
    const currentAssignee = (currentAssigneeRow && currentAssigneeRow.style.display !== 'none')
        ? (this.shadowRoot.getElementById('f-current-assignee')?.value || null) : null;

    const isPausedCb = this.shadowRoot.getElementById('f-pause-cb')?.checked || false;
    const pauseDateVal = this.shadowRoot.getElementById('f-pause-date')?.value;
    const pausedUntil = (isPausedCb && pauseDateVal) ? pauseDateVal : null;

    const isRestrictMonthsCb = this.shadowRoot.getElementById('f-restrict-months-cb')?.checked || false;
    let activeMonths = null;
    if (isRestrictMonthsCb) {
        activeMonths = [];
        this.shadowRoot.querySelectorAll('#f-months-band .month-pill.selected').forEach(p => {
            activeMonths.push(parseInt(p.dataset.month));
        });
        if (activeMonths.length === 0) activeMonths = null;
    }

    const isOverrideOverdueCb = this.shadowRoot.getElementById('f-override-overdue-cb')?.checked || false;
    const overrideOverdueDaysVal = this.shadowRoot.getElementById('f-override-overdue-days')?.value;
    const overrideOverdueDays = (isOverrideOverdueCb && overrideOverdueDaysVal) ? (parseInt(overrideOverdueDaysVal) || null) : null;

    const payload = {
      name: name, 
      description: this.shadowRoot.getElementById('f-description')?.value || "",
      area: this.shadowRoot.getElementById('f-area')?.value || "",
      interval: isOnetime ? 0 : Math.max(1, parseInt(this.shadowRoot.getElementById('f-interval')?.value) || 7),
      schedule: schedule,
      complexity: parseInt(this.shadowRoot.getElementById('f-complexity')?.value) || 5, 
      icon: this.shadowRoot.getElementById('f-icon-picker')?.value || "mdi:broom",
      category: "Allgemein", 
      assignees: assignees,
      current_assignee: currentAssignee,
      custom_due_date: customDueDate,
      paused_until: pausedUntil,
      active_months: activeMonths,
      override_overdue_days: overrideOverdueDays,
      subtasks: this._subtasks,
      images: this._currentTaskImages
    };
    
    this.dispatchEvent(new CustomEvent('task-saved', {
        detail: { payload, editingTaskId: this._editingTaskId },
        bubbles: true, composed: true
    }));
    this._close();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); z-index: 5000; justify-content: center; align-items: flex-start; padding-top: 120px; padding-bottom: 24px; box-sizing: border-box; overflow-y: auto; } 
        .modal.open { display: flex; } 
        .modal-content { background: var(--card-background-color); color: var(--primary-text-color); padding: 24px; border-radius: var(--ha-dialog-border-radius, 28px); width: fit-content; max-width: calc(100% - 32px); max-height: calc(100vh - 150px); overflow-y: auto; box-shadow: 0px 4px 16px rgba(0,0,0,0.5); margin: 0 16px; box-sizing: border-box; }
        @media (max-width: 768px), (max-height: 768px) {
            .modal { padding-top: 16px; padding-bottom: 16px; }
            .modal-content { max-height: calc(100vh - 32px); }
        }
        @media (max-width: 768px) {
            .modal-content { padding: 16px; width: calc(100% - 32px); max-width: calc(100% - 32px); margin: 0 16px; border-radius: var(--ha-dialog-border-radius, 28px); }
        }
        .modal-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
        .modal-header h2 { margin: 0; }
        .tabs-container { display: flex; align-items: center; border-bottom: 1px solid var(--divider-color); margin-bottom: 16px; position: relative; }
        .tabs { display: flex; overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; scroll-behavior: smooth; flex: 1; }
        .tabs::-webkit-scrollbar { display: none; }
        .tab-btn { display: flex; align-items: center; justify-content: center; gap: 4px; flex: 0 0 auto; min-width: max-content; padding: 12px 6px; background: transparent; border: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--secondary-text-color); font-size: 11px; font-weight: 500; transition: color 0.2s, border-color 0.2s; --mdc-icon-size: 16px; }
        .tab-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tab-btn:hover { color: var(--primary-text-color); }
        .tab-btn.active { color: var(--primary-color); border-bottom-color: var(--primary-color); }
        .scroll-indicator { background: var(--card-background-color, #fff); border: none; color: var(--primary-text-color); font-size: 16px; cursor: pointer; padding: 0 8px; z-index: 2; box-shadow: 0 0 4px rgba(0,0,0,0.1); height: 100%; position: absolute; top: 0; display: none; align-items: center; justify-content: center; }
        #scroll-left { left: 0; }
        #scroll-right { right: 0; }
        .tab-content { display: none; flex-direction: column; gap: 16px; animation: fadeIn 0.3s; }
        .tab-content.active { display: flex; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .form-row { display: flex; gap: 16px; width: 100%; box-sizing: border-box; }
        .form-col { flex: 1; min-width: 0; width: 100%; }
        .form-label { font-size: 12px; color: var(--secondary-text-color); margin-bottom: 4px; display: block; }
        .assignees-container { display: flex; flex-direction: column; gap: 8px; max-height: 150px; overflow-y: auto; padding-top: 8px; }
        #template-suggestions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .suggestion-item { background: var(--secondary-background-color); color: var(--primary-text-color); border: 1px solid var(--divider-color); border-radius: 16px; padding: 6px 12px; font-size: 12px; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; gap: 4px; }
        .suggestion-item:hover { background: var(--primary-color); color: var(--text-primary-color); }
        .task-type-selector { position: relative; display: grid; grid-template-columns: 1fr 1fr; background: var(--secondary-background-color); border-radius: 12px; border: 1px solid var(--divider-color); overflow: hidden; align-self: center; box-sizing: border-box; max-width: 100%; }
        .type-slider { position: absolute; top: 0; bottom: 0; left: 0; width: 50%; background: var(--primary-color); transition: transform 0.3s ease; z-index: 0; }
        .task-type-selector[data-active="recurring"] .type-slider { transform: translateX(0); }
        .task-type-selector[data-active="onetime"] .type-slider { transform: translateX(100%); }
        .type-btn { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 10px; background: transparent; border: none; cursor: pointer; color: var(--secondary-text-color); font-size: 11px; font-weight: 500; transition: color 0.3s; z-index: 1; white-space: nowrap; user-select: none; }
        .type-btn ha-icon { --mdc-icon-size: 16px; }
        .type-btn.active { color: var(--text-primary-color, white); }
        .subtask-input-row { display: flex; gap: 8px; align-items: center; }
        .subtask-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; max-height: 200px; overflow-y: auto; }
        .image-dropzone { border: 2px dashed var(--divider-color); border-radius: 8px; padding: 16px; text-align: center; color: var(--secondary-text-color); cursor: pointer; transition: background-color 0.2s, border-color 0.2s; min-height: 80px; display: flex; flex-direction: column; justify-content: center; align-items: center; }
        .image-dropzone:hover, .image-dropzone.dragover { background-color: rgba(var(--rgb-primary-color), 0.05); border-color: var(--primary-color); }
        .image-gallery { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; justify-content: center; width: 100%; }
        .history-timeline { display: flex; flex-direction: column; gap: 0; padding-left: 16px; position: relative; }
        .history-timeline::before { content: ''; position: absolute; left: 32px; top: 16px; bottom: 16px; width: 2px; background: var(--divider-color); z-index: 0; }
        .month-pill { padding: 8px 12px; border-radius: 16px; background: var(--secondary-background-color, #e0e0e0); color: var(--primary-text-color); border: 1px solid var(--divider-color); cursor: pointer; user-select: none; transition: background 0.2s, color 0.2s; }
        .modal-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 24px; }
        .modal-footer-left { display: flex; align-items: center; }
        .modal-footer-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }
        .btn-danger { color: var(--error-color, #F44336) !important; --mdc-theme-primary: var(--error-color, #F44336); }
        .btn-danger ha-icon { --mdc-icon-size: 18px; margin-right: 4px; }
        .native-select { width: 100%; height: 56px; box-sizing: border-box; padding: 0 12px; border: 1px solid var(--divider-color); border-radius: 4px; background: transparent; color: var(--primary-text-color); font-size: 16px; font-family: inherit; }
        .pill { padding: 10px 14px; min-width: 44px; box-sizing: border-box; text-align: center; border-radius: 20px; background: var(--secondary-background-color, #e0e0e0); color: var(--primary-text-color); border: 1px solid var(--divider-color); cursor: pointer; user-select: none; font-size: 14px; transition: background 0.2s, color 0.2s, border-color 0.2s; }
        .pill.selected { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
        .pick-due { position: relative; }
        .pick-due-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 48px; box-sizing: border-box; padding: 0 16px; border: 1px solid var(--primary-color); border-radius: 12px; background: transparent; color: var(--primary-color); font-size: 14px; font-weight: 500; font-family: inherit; cursor: pointer; }
        .pick-due input[type="date"] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: none; padding: 0; }
        .due-info { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--secondary-background-color); }
        .due-info .due-label { font-size: 12px; color: var(--secondary-text-color); }
        .due-info .due-value { font-size: 15px; font-weight: 500; color: var(--primary-text-color); }
        .reset-due-btn { display: flex; align-items: center; gap: 4px; border: none; background: transparent; color: var(--primary-color); font-size: 12px; font-family: inherit; cursor: pointer; padding: 6px; }
        .native-select option { background: var(--card-background-color); color: var(--primary-text-color); }
      </style>
      <div id="task-modal" class="modal">
          <div class="modal-content">
              <div class="modal-header">
                  <h2>${this.localize('task')}</h2>
                  <div class="task-type-selector" data-active="recurring">
                      <div class="type-slider"></div>
                      <button type="button" class="type-btn active" id="btn-type-recurring">
                          <ha-icon icon="mdi:calendar-sync"></ha-icon>
                          <span>${this.localize('recurring')}</span>
                      </button>
                      <button type="button" class="type-btn" id="btn-type-onetime">
                          <ha-icon icon="mdi:calendar-check"></ha-icon>
                          <span>${this.localize('onetime')}</span>
                      </button>
                  </div>
              </div>
              
              <div class="tabs-container">
                  <button class="scroll-indicator" id="scroll-left" style="display: none;">&lt;</button>
                  <div class="tabs" id="tabs-scroll">
                      <button class="tab-btn active" data-tab="tab-general">
                          <ha-icon icon="mdi:information-outline"></ha-icon>
                          <span>${this.localize('tab_general')}</span>
                      </button>
                      <button class="tab-btn" data-tab="tab-time">
                          <ha-icon icon="mdi:clock-outline"></ha-icon>
                          <span>${this.localize('tab_time')}</span>
                      </button>
                      <button class="tab-btn" data-tab="tab-subtasks">
                          <ha-icon icon="mdi:format-list-checks"></ha-icon>
                          <span>${this.localize('tab_subtasks')}</span>
                      </button>
                      <button class="tab-btn" data-tab="tab-other">
                          <ha-icon icon="mdi:dots-grid"></ha-icon>
                          <span>${this.localize('tab_other')}</span>
                      </button>
                      <button class="tab-btn" data-tab="tab-history">
                          <ha-icon icon="mdi:history"></ha-icon>
                          <span>${this.localize('tab_history')}</span>
                      </button>
                  </div>
                  <button class="scroll-indicator" id="scroll-right" style="display: none;">&gt;</button>
              </div>
              
              <div class="tab-content active" id="tab-general">

                  <div>
                      <ha-input id="f-name" label="${this.localize('name_lbl')}" style="width: 100%;"></ha-input>
                      <div id="template-suggestions"></div>
                  </div>
                  
                  <div class="form-row">
                      <ha-input id="f-complexity" type="number" label="${this.localize('points_lbl')}" min="1" max="10" class="form-col"></ha-input>
                  </div>

                  <div class="form-row">
                      <div class="form-col">
                          <label class="form-label">${this.localize('icon_lbl')}</label>
                          <ha-icon-picker id="f-icon-picker"></ha-icon-picker>
                      </div>
                  </div>

                  <div>
                      <label class="form-label">${this.localize('assignees_lbl')}</label>
                      <div class="assignees-container">
                          ${Object.entries(this._users).map(([uid, name]) => 
                              renderCheckbox({ className: 'assignee-cb', id: `cb-${uid}`, value: uid, label: name })
                          ).join('')}
                      </div>
                  </div>

                  <div id="f-current-assignee-row" style="display:none;">
                      <label class="form-label">${this.localize('current_assignee_lbl')}</label>
                      <select id="f-current-assignee" class="native-select"></select>
                      <div style="font-size:12px; color: var(--secondary-text-color); margin-top:4px;">${this.localize('current_assignee_hint')}</div>
                  </div>
              </div>
              
              <div class="tab-content" id="tab-time">
                  <div style="display:flex; flex-direction:column; gap:16px;">
                      <ha-input id="f-interval" type="number" min="0" label="${this.localize('interval_lbl')}" style="width:100%;"></ha-input>

                      <div id="f-schedule-block" style="display:flex; flex-direction:column; gap:16px;">
                          <div>
                              <label class="form-label">${this.localize('repeat_mode_lbl')}</label>
                              <select id="f-schedule-type" class="native-select">
                                  <option value="interval">${this.localize('repeat_interval')}</option>
                                  <option value="weekly">${this.localize('repeat_weekly')}</option>
                                  <option value="monthly">${this.localize('repeat_monthly')}</option>
                                  <option value="quarterly">${this.localize('repeat_quarterly')}</option>
                                  <option value="halfyearly">${this.localize('repeat_halfyearly')}</option>
                                  <option value="yearly">${this.localize('repeat_yearly')}</option>
                              </select>
                          </div>
                          <div id="f-schedule-weekday-row" style="display:none;">
                              <label class="form-label">${this.localize('weekdays_lbl')}</label>
                              <div id="f-schedule-weekdays" style="display:flex; flex-wrap:wrap; gap:8px;">${this._weekdayPillsHtml()}</div>
                          </div>
                          <div id="f-schedule-month-row" style="display:none;">
                              <label class="form-label" id="f-schedule-month-label"></label>
                              <select id="f-schedule-month" class="native-select"></select>
                          </div>
                          <div id="f-schedule-day-row" style="display:none;">
                              <ha-input id="f-schedule-day" type="number" min="1" max="31" label="${this.localize('day_of_month_lbl')}" style="width:100%;"></ha-input>
                              <div style="font-size:12px; color: var(--secondary-text-color); margin-top:4px;">${this.localize('day_of_month_hint')}</div>
                          </div>
                      </div>

                      <div style="display:flex; flex-direction:column; gap:8px; align-items:stretch;">
                          <div class="due-info">
                              <div>
                                  <div class="due-label">${this.localize('next_due_lbl')}</div>
                                  <div class="due-value" id="f-next-due-info"></div>
                              </div>
                              <button type="button" class="reset-due-btn" id="f-reset-due-btn" style="display:none;">
                                  <ha-icon icon="mdi:close" style="--mdc-icon-size: 16px;"></ha-icon>${this.localize('reset_manual_due')}
                              </button>
                          </div>
                          <div class="pick-due">
                              <button type="button" class="pick-due-btn" id="f-pick-due-btn">
                                  <ha-icon icon="mdi:calendar-edit"></ha-icon>${this.localize('pick_next_due_btn')}
                              </button>
                              <input type="date" id="f-custom-due-date" aria-label="${this.localize('pick_next_due_btn')}">
                          </div>
                          <div style="font-size:12px; color: var(--secondary-text-color);">${this.localize('manual_due_hint')}</div>
                      </div>
                      <div style="display:flex; flex-direction:column; gap:8px; align-items:stretch;">
                          ${renderSwitch({ id: 'f-override-overdue-cb', label: this.localize('override_overdue_lbl') })}
                          <ha-input id="f-override-overdue-days" type="number" min="0" max="9999" style="width:100%; display: none;" placeholder="${this.localize('override_overdue_days_placeholder')}"></ha-input>
                      </div>
                      <div style="display:flex; flex-direction:column; gap:8px; align-items:stretch;">
                          ${renderSwitch({ id: 'f-pause-cb', label: this.localize('pause_until') })}
                          <input type="date" id="f-pause-date" style="width:100%; height: 56px; box-sizing: border-box; padding: 0 16px; border: 1px solid var(--divider-color); border-radius: 4px; background: transparent; color: var(--primary-text-color); font-size: 16px; font-family: inherit; display: none;">
                      </div>
                      <div style="display:flex; flex-direction:column; gap:8px;">
                          ${renderSwitch({ id: 'f-restrict-months-cb', label: this.localize('restrict_months_lbl') })}
                          <div id="f-months-band" style="display:none; flex-wrap:wrap; gap:8px; margin-top:8px;">
                              ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
                                  const mName = new Date(2000, m-1, 1).toLocaleString(this._hass?.language || 'de', { month: 'short' });
                                  return `<div class="month-pill" data-month="${m}">${mName}</div>`;
                              }).join('')}
                          </div>
                      </div>
                  </div>
              </div>

              <div class="tab-content" id="tab-subtasks">
                  <div class="subtask-input-row">
                      <ha-input id="new-subtask-title" placeholder="${this.localize('subtask_placeholder')}" style="flex: 1;"></ha-input>
                      <ha-button id="btn-add-subtask">${this.localize('confirm')}</ha-button>
                  </div>
                  <div id="subtask-list" class="subtask-list"></div>
              </div>

              <div class="tab-content" id="tab-other">
                  <ha-input id="f-description" label="${this.localize('desc_lbl')}"></ha-input>
                  <div>
                      <label class="form-label">${this.localize('area_lbl')}</label>
                      <ha-area-picker id="f-area"></ha-area-picker>
                  </div>
                  <div>
                      <label class="form-label">Dateien</label>
                      <div class="image-dropzone" id="f-image-dropzone">
                          <div id="f-image-dropzone-text" style="display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none;">
                              <ha-icon icon="mdi:cloud-upload-outline"></ha-icon>
                              <span>Dateien in den Rahmen ziehen oder hier klicken</span>
                          </div>
                          <div id="f-images-gallery" class="image-gallery"></div>
                          <input type="file" id="f-images-upload" multiple accept="*/*" style="display: none;">
                      </div>
                  </div>
              </div>
              
              <div class="tab-content" id="tab-history">
                  <div id="f-history-container"></div>
              </div>
              
              <div class="modal-footer">
                  <div class="modal-footer-left">
                      <ha-button appearance="plain" variant="danger" id="btn-modal-delete" class="btn-danger" style="display: none;">
                          <ha-icon icon="mdi:delete" slot="icon"></ha-icon>
                          ${this.localize('delete')}
                      </ha-button>
                  </div>
                  <div class="modal-footer-right">
                      <ha-button appearance="plain" variant="brand" id="btn-modal-cancel">${this.localize('cancel')}</ha-button>
                      <ha-button raised id="btn-modal-save">${this.localize('save')}</ha-button>
                  </div>
              </div>
          </div>
      </div>
    `;

    const nameField = this.shadowRoot.getElementById('f-name');
    if (nameField) nameField.addEventListener('input', (e) => this._handleTemplateSuggestions(e));
    
    const pauseCb = this.shadowRoot.getElementById('f-pause-cb');
    const pauseDate = this.shadowRoot.getElementById('f-pause-date');
    if (pauseCb && pauseDate) {
        pauseCb.addEventListener('change', (e) => {
            pauseDate.style.display = e.target.checked ? '' : 'none';
            if (e.target.checked && !pauseDate.value) {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                pauseDate.value = tomorrow.toISOString().split('T')[0];
            }
        });
    }

    const restrictMonthsCb = this.shadowRoot.getElementById('f-restrict-months-cb');
    const monthsBand = this.shadowRoot.getElementById('f-months-band');
    if (restrictMonthsCb && monthsBand) {
        restrictMonthsCb.addEventListener('change', (e) => {
            monthsBand.style.display = e.target.checked ? 'flex' : 'none';
            if (!e.target.checked) {
                monthsBand.querySelectorAll('.month-pill').forEach(p => {
                    p.style.background = 'var(--secondary-background-color, #e0e0e0)';
                    p.style.color = 'var(--primary-text-color)';
                    p.classList.remove('selected');
                });
            }
        });
        monthsBand.querySelectorAll('.month-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                const p = e.target;
                p.classList.toggle('selected');
                if (p.classList.contains('selected')) {
                    p.style.background = 'var(--primary-color)';
                    p.style.color = 'var(--text-primary-color)';
                } else {
                    p.style.background = 'var(--secondary-background-color, #e0e0e0)';
                    p.style.color = 'var(--primary-text-color)';
                }
            });
        });
    }

    const customDueDateInput = this.shadowRoot.getElementById('f-custom-due-date');
    if (customDueDateInput) {
        // The transparent date field covers the button: a tap opens the calendar directly on touch screens.
        customDueDateInput.addEventListener('click', () => { try { customDueDateInput.showPicker?.(); } catch (err) { /* not supported */ } });
        customDueDateInput.addEventListener('change', (e) => this._onDuePicked(e.target.value));
        customDueDateInput.addEventListener('input', (e) => this._onDuePicked(e.target.value));
    }
    this.shadowRoot.getElementById('f-reset-due-btn')?.addEventListener('click', () => this._resetDueOverride());

    this.shadowRoot.querySelectorAll('#f-schedule-weekdays .weekday-pill').forEach(pill => {
        const toggle = () => {
            pill.classList.toggle('selected');
            this._onScheduleChanged();
        };
        pill.addEventListener('click', toggle);
        pill.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });

    const assigneesContainer = this.shadowRoot.querySelector('.assignees-container');
    if (assigneesContainer) {
        const refresh = () => setTimeout(() => this._refreshCurrentAssigneeUI(null), 50);
        assigneesContainer.addEventListener('change', refresh);
        assigneesContainer.addEventListener('click', refresh);
    }

    const overrideOverdueCb = this.shadowRoot.getElementById('f-override-overdue-cb');
    const overrideOverdueDays = this.shadowRoot.getElementById('f-override-overdue-days');
    if (overrideOverdueCb && overrideOverdueDays) {
        overrideOverdueCb.addEventListener('change', (e) => {
            overrideOverdueDays.style.display = e.target.checked ? '' : 'none';
            if (!e.target.checked) {
                overrideOverdueDays.value = "";
            }
        });
    }

    this.shadowRoot.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            this.shadowRoot.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.shadowRoot.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const currentBtn = e.currentTarget;
            const tabId = currentBtn.getAttribute('data-tab');
            currentBtn.classList.add('active');
            const targetContent = this.shadowRoot.getElementById(tabId);
            if (targetContent) targetContent.classList.add('active');
            currentBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            this._updateTabScrollIndicators();
        });
    });

    const tabsScroll = this.shadowRoot.getElementById('tabs-scroll');
    const scrollLeftBtn = this.shadowRoot.getElementById('scroll-left');
    const scrollRightBtn = this.shadowRoot.getElementById('scroll-right');

    if (scrollLeftBtn && tabsScroll) {
        scrollLeftBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            tabsScroll.scrollBy({ left: -100, behavior: 'smooth' });
        });
    }

    if (scrollRightBtn && tabsScroll) {
        scrollRightBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            tabsScroll.scrollBy({ left: 100, behavior: 'smooth' });
        });
    }

    if (tabsScroll) {
        tabsScroll.addEventListener('scroll', () => this._updateTabScrollIndicators());
        tabsScroll.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0 && tabsScroll.scrollWidth > tabsScroll.clientWidth) {
                e.preventDefault();
                tabsScroll.scrollLeft += e.deltaY;
            }
        }, { passive: false });
        window.addEventListener('resize', () => this._updateTabScrollIndicators());
        if (window.ResizeObserver) {
            new ResizeObserver(() => this._updateTabScrollIndicators()).observe(tabsScroll);
        }
    }

    const dropzone = this.shadowRoot.getElementById('f-image-dropzone');
    const fileInput = this.shadowRoot.getElementById('f-images-upload');
    if (dropzone && fileInput) {
        dropzone.addEventListener('click', (e) => {
            if (e.target !== fileInput) {
                fileInput.click();
            }
        });
        fileInput.addEventListener('change', (e) => this._handleImageSelection(e));
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                this._handleImageSelection({ target: { files: e.dataTransfer.files } });
            }
        });
    }

    this.shadowRoot.getElementById('btn-type-onetime').addEventListener('click', () => this._updateTaskTypeUI(true));
    this.shadowRoot.getElementById('btn-type-recurring').addEventListener('click', () => this._updateTaskTypeUI(false));
    
    const intervalField = this.shadowRoot.getElementById('f-interval');
    if (intervalField) {
        intervalField.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val) && val > 0) {
                this._previousInterval = val;
            }
        });
    }
    ['f-schedule-type', 'f-schedule-month'].forEach(id => {
        this.shadowRoot.getElementById(id)?.addEventListener('change', (e) => this._onScheduleChanged(e));
    });
    this.shadowRoot.getElementById('f-schedule-day')?.addEventListener('input', (e) => this._onScheduleChanged(e));
    const deleteBtn = this.shadowRoot.getElementById('btn-modal-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => this._deleteTask());
    }
    this.shadowRoot.getElementById('btn-add-subtask').addEventListener('click', () => this._addSubtask());
    this.shadowRoot.getElementById('btn-modal-cancel').addEventListener('click', () => this._close());
    this.shadowRoot.getElementById('btn-modal-save').addEventListener('click', () => this._saveTask());
    
    const iconPicker = this.shadowRoot.getElementById('f-icon-picker');
    if (iconPicker) iconPicker.addEventListener('value-changed', (e) => this._currentIcon = e.detail.value);
  }
}
try { customElements.define('task-organizer-task-modal', TaskOrganizerTaskModal); } catch (e) { if (!e.message.includes('already been used')) { throw e; } }
