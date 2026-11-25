const _v = new URLSearchParams(import.meta.url.split('?')[1]).get('v') || Date.now();
const { localize, renderCheckbox } = await import(`./utils/i18n.js?v=${_v}`);

// This card builds on the task list card, so it waits until that one is registered.
await customElements.whenDefined('task-organizer-card');
await customElements.whenDefined('task-organizer-card-editor');
const BaseCard = customElements.get('task-organizer-card');
const BaseEditor = customElements.get('task-organizer-card-editor');

window.customCards = window.customCards || [];
window.customCards.push({
  type: "task-organizer-due-card",
  name: "Klusjesbeheer: Openstaande klusjes",
  description: "Shows only the tasks that are due. Completing one plays a small celebration.",
  preview: true,
});

const LONG_PRESS_MS = 550;    // press and hold this long to open the "who does it this time" menu
const HOLD_MS = 950;          // how long a completed entry stays visible for the celebration
const HOLD_REDUCED_MS = 350;  // the same for people who prefer reduced motion
const EXIT_MS = 400;          // length of the disappearing animation
const CONFETTI_COLORS = ['#ff5a5f', '#ffb300', '#43a047', '#29b6f6', '#ab47bc', '#ff7043'];

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
};

class KlusjesbeheerDueCard extends BaseCard {
  constructor() {
    super();
    this._holding = false;
    this._holdTimer = null;
    this._audioCtx = null;
    // Browsers only allow sound after the person has touched the page. Touching the card is enough to unlock it.
    this.addEventListener('pointerdown', () => this._primeAudio(), { passive: true });

    // Press and hold a task with one assignee: let somebody else do it this one time.
    this._lpTimer = null;
    this._lpFired = false;
    this._lpSuppressUntil = 0;
    const root = this.shadowRoot;
    root.addEventListener('pointerdown', (ev) => this._lpStart(ev), { passive: true });
    root.addEventListener('pointermove', (ev) => this._lpMove(ev), { passive: true });
    root.addEventListener('pointerup', () => {
      // Releasing a long press may still produce a click; ignore only that one (it comes right away).
      if (this._lpFired) { this._lpFired = false; this._lpSuppressUntil = Date.now() + 400; }
      this._lpCancel();
    }, { passive: true });
    root.addEventListener('pointercancel', () => this._lpCancel(), { passive: true });
    // The tap that ends a long press must not also tick the task off or open a popup.
    root.addEventListener('click', (ev) => {
      if (this._lpFired || Date.now() < this._lpSuppressUntil) {
        this._lpFired = false;
        this._lpSuppressUntil = 0;
        ev.stopPropagation();
        ev.preventDefault();
      }
    }, true);
    root.addEventListener('contextmenu', (ev) => {
      if (ev.composedPath().some(el => el.classList && el.classList.contains('task-item'))) ev.preventDefault();
    });
  }

  static getConfigElement() {
    return document.createElement('task-organizer-due-card-editor');
  }

  static getStubConfig(hass) {
    return {
      type: "custom:task-organizer-due-card",
      title: this._localize(hass, 'due_title'),
      sort_by: "due_date",
      sort_order: "default",
      filter_by: "none",
      items_per_page: 10,
      show_search: false,
      show_add: false,
      celebrate: true,
      sound: true
    };
  }

  // --- differences with the full task list -------------------------------------------------
  _defaultTitle() { return this.localize('due_title'); }
  _allowManage() { return false; }   // no edit and no delete buttons
  _onlyDue() { return true; }        // only due and overdue tasks

  _getStyles() {
    const extra = `
          .task-item.celebrating { pointer-events: none; --status-color: var(--success-color, #4CAF50) !important; }
          .task-item.celebrating .btn-complete { color: #fff; background-color: var(--success-color, #4CAF50); box-shadow: none; animation: to-pop 0.5s cubic-bezier(0.2, 1.5, 0.4, 1); }
          .task-item.celebrating .btn-complete ha-icon { animation: to-tick 0.4s ease-out; }
          .task-item.celebrating .btn-complete::after { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--success-color, #4CAF50); animation: to-ring 0.6s ease-out forwards; pointer-events: none; }
          @keyframes to-pop { 0% { transform: scale(1); } 40% { transform: scale(1.22); } 100% { transform: scale(1); } }
          @keyframes to-tick { 0% { transform: scale(0.4) rotate(-25deg); opacity: 0; } 60% { opacity: 1; } 100% { transform: scale(1) rotate(0); } }
          @keyframes to-ring { 0% { transform: scale(1); opacity: 0.9; } 100% { transform: scale(1.5); opacity: 0; } }
          @media (prefers-reduced-motion: reduce) { .task-item.celebrating .btn-complete, .task-item.celebrating .btn-complete ha-icon, .task-item.celebrating .btn-complete::after { animation: none; } }
          .task-item { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
          .task-item.pressing { transform: scale(0.97); transition: transform ${LONG_PRESS_MS}ms ease-out, background-color 0.2s; }
          .sm-backdrop { position: fixed; inset: 0; z-index: 5000; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; animation: sm-fade 0.15s ease-out; }
          .sm-dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: var(--ha-card-border-radius, 16px); width: min(440px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; padding: 20px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); animation: sm-pop 0.18s ease-out; }
          .sm-title { font-size: 20px; font-weight: 600; margin: 0; }
          .sm-task { font-size: 14px; color: var(--secondary-text-color); margin-top: 2px; }
          .sm-desc { font-size: 14px; color: var(--secondary-text-color); line-height: 1.4; }
          .sm-list { display: flex; flex-direction: column; gap: 8px; }
          .sm-row { display: flex; align-items: center; gap: 14px; min-height: 60px; padding: 8px 14px; border-radius: 12px; border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); font: inherit; font-size: 17px; text-align: left; cursor: pointer; width: 100%; box-sizing: border-box; }
          .sm-row:active { background: var(--secondary-background-color); }
          .sm-row .mini-avatar { width: 40px; height: 40px; font-size: 16px; box-shadow: none; flex-shrink: 0; }
          .sm-row.sm-reset { border-style: dashed; }
          .sm-row ha-icon { --mdc-icon-size: 24px; color: var(--secondary-text-color); margin-left: auto; }
          .sm-empty { font-size: 14px; color: var(--secondary-text-color); padding: 8px 0; }
          .sm-foot { display: flex; justify-content: flex-end; }
          .sm-cancel { background: transparent; border: none; color: var(--primary-color); font: inherit; font-size: 15px; font-weight: 500; padding: 10px 14px; border-radius: 8px; cursor: pointer; }
          @keyframes sm-fade { from { opacity: 0; } to { opacity: 1; } }
          @keyframes sm-pop { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    `;
    return super._getStyles().replace('</style>', extra + '</style>');
  }

  // --- keep the finished entry on screen while it celebrates -------------------------------
  _fetchData() {
    const p = super._fetchData();
    this._lastFetch = p;
    return p;
  }

  _renderTaskList() {
    // While an entry celebrates the list is frozen. It is redrawn when the celebration is over.
    if (this._holding) { this._renderPending = true; return; }
    super._renderTaskList();
  }

  /** The list is frozen from the moment the completion is sent, so a refresh cannot remove the entry too early. */
  _completeTask(taskId, completedBy, pointsDistribution = null) {
    if (this._config.celebrate !== false) {
      this._holding = true;
      clearTimeout(this._holdTimer);
      this._holdTimer = setTimeout(() => this._release(false), 10000); // safety net if nothing answers
    }
    return super._completeTask(taskId, completedBy, pointsDistribution);
  }

  _onTaskCompleteFailed(taskId) {
    clearTimeout(this._holdTimer);
    this._holding = false;
    this._renderTaskList();
  }

  _onTaskCompleted(taskId) {
    const reduced = prefersReducedMotion();
    const entry = this.shadowRoot && this.shadowRoot.querySelector(`.task-item[data-id="${CSS.escape(String(taskId))}"]`);

    if (this._config.sound !== false) this._playChime();

    if (this._config.celebrate === false || !entry) {
      // Nothing to celebrate on: let the normal refresh that follows draw the list.
      clearTimeout(this._holdTimer);
      this._holding = false;
      return;
    }

    entry.classList.add('celebrating');
    const btn = entry.querySelector('.btn-complete');
    if (btn && !reduced) {
      const r = btn.getBoundingClientRect();
      this._confetti(r.left + r.width / 2, r.top + r.height / 2);
    }
    this._scheduleRelease(reduced);
  }

  _scheduleRelease(reduced) {
    clearTimeout(this._holdTimer);
    this._holdTimer = setTimeout(() => this._release(!reduced), reduced ? HOLD_REDUCED_MS : HOLD_MS);
  }

  async _release(animate) {
    // Wait for the new data (but never longer than two seconds) so the entry is really gone.
    try {
      await Promise.race([Promise.resolve(this._lastFetch).catch(() => {}), new Promise(r => setTimeout(r, 2000))]);
    } catch (e) { /* ignore */ }
    const entries = [...this.shadowRoot.querySelectorAll('.task-item.celebrating')];
    if (animate && entries.length) await this._playExit(entries);
    this._holding = false;
    super._renderTaskList();
  }

  /**
   * When the last task leaves, the "no tasks" line is put in place at the same time, so the card
   * shrinks once, smoothly, instead of collapsing fully and growing again.
   */
  _insertEmptyLine(entries, gap) {
    const list = this.shadowRoot.querySelector('.task-list');
    if (!list) return null;
    const others = [...list.querySelectorAll('.task-item')].filter(el => !entries.includes(el));
    if (others.length > 0 || list.querySelector('.no-tasks')) return null;

    const holder = document.createElement('div');
    holder.innerHTML = this._emptyHtml();
    const line = holder.firstElementChild;
    if (!line) return null;
    list.appendChild(line);
    const h = line.offsetHeight;
    const cs = getComputedStyle(line);
    line.style.boxSizing = 'border-box';
    line.style.overflow = 'hidden';
    // The negative top margin cancels the list gap, so adding the line does not make the card taller.
    return line.animate([
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: `-${gap}px`, opacity: 0 },
      { opacity: 0, offset: 0.45 },
      { height: `${h}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: '0px', opacity: 1 }
    ], { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
  }

  /** Fades the entry out and lets the ones below slide up. */
  _playExit(entries) {
    const gap = 10;
    const emptyLine = this._insertEmptyLine(entries, gap);
    const animations = entries.map(el => {
      const h = el.offsetHeight;
      return el.animate([
        { height: `${h}px`, minHeight: `${h}px`, opacity: 1, transform: 'translateX(0) scale(1)', marginBottom: '0px' },
        { opacity: 0, transform: 'translateX(28px) scale(0.96)', offset: 0.45 },
        { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px', opacity: 0, transform: 'translateX(28px) scale(0.96)', marginBottom: `-${gap}px` }
      ], { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    });
    if (emptyLine) animations.push(emptyLine);
    return Promise.all(animations.map(a => a.finished.catch(() => {})));
  }

  // --- press and hold: somebody else does it this time -------------------------------------
  _lpStart(ev) {
    this._lpFired = false;
    this._lpSuppressUntil = 0;
    if (ev.button > 0 || this._holding) return;
    const entry = ev.composedPath().find(el => el.classList && el.classList.contains('task-item'));
    if (!entry || !entry.dataset.single || entry.classList.contains('celebrating')) return;
    this._lpCancel();
    this._lpEntry = entry;
    this._lpX = ev.clientX;
    this._lpY = ev.clientY;
    entry.classList.add('pressing');
    this._lpTimer = setTimeout(() => {
      this._lpTimer = null;
      entry.classList.remove('pressing');
      this._lpFired = true;
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) { /* not supported */ }
      this._openStandIn(entry.dataset.id);
    }, LONG_PRESS_MS);
  }

  _lpMove(ev) {
    if (!this._lpTimer) return;
    if (Math.abs(ev.clientX - this._lpX) > 10 || Math.abs(ev.clientY - this._lpY) > 10) this._lpCancel();
  }

  _lpCancel() {
    if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null; }
    if (this._lpEntry) { this._lpEntry.classList.remove('pressing'); this._lpEntry = null; }
  }

  _avatarHtml(uid) {
    const name = this.users[uid] || this.localize('unknown');
    const picture = this.userPictures && this.userPictures[uid];
    const pictureHtml = picture ? `<img src="${String(picture).replace(/"/g, '&quot;')}" alt="" onerror="this.remove()">` : '';
    return `<div class="mini-avatar"><span>${name.charAt(0).toUpperCase()}</span>${pictureHtml}</div>`;
  }

  _openStandIn(taskId) {
    const task = this.tasks && this.tasks[taskId];
    if (!task) return;
    const pool = (Array.isArray(task.assignees) ? task.assignees : [task.assignees]).filter(Boolean);
    if (pool.length !== 1) return;
    const owner = pool[0];
    const ownerName = this.users[owner] || this.localize('unknown');
    const standIn = task.stand_in && task.stand_in !== owner ? task.stand_in : null;

    const candidates = Object.keys(this._assignableUsers())
      .filter(uid => uid !== owner && uid !== standIn)
      .sort((a, b) => String(this.users[a]).localeCompare(String(this.users[b])));

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let rows = '';
    if (standIn) {
      rows += `<button class="sm-row sm-reset" data-uid="">${this._avatarHtml(owner)}<span>${esc(this.localize('standin_reset', { name: ownerName }))}</span><ha-icon icon="mdi:undo-variant"></ha-icon></button>`;
    }
    rows += candidates.map(uid => `<button class="sm-row" data-uid="${esc(uid)}">${this._avatarHtml(uid)}<span>${esc(this.users[uid])}</span><ha-icon icon="mdi:account-switch"></ha-icon></button>`).join('');
    if (!rows) rows = `<div class="sm-empty">${esc(this.localize('standin_none'))}</div>`;

    this._closeStandIn();
    const modal = document.createElement('div');
    modal.className = 'sm-backdrop';
    modal.id = 'standin-modal';
    modal.innerHTML = `
      <div class="sm-dialog" role="dialog" aria-modal="true">
        <div>
          <div class="sm-title">${esc(this.localize('standin_title'))}</div>
          <div class="sm-task">${esc(task.name)}</div>
        </div>
        <div class="sm-desc">${esc(this.localize('standin_desc', { name: ownerName }))}</div>
        <div class="sm-list">${rows}</div>
        <div class="sm-foot"><button class="sm-cancel">${esc(this.localize('cancel'))}</button></div>
      </div>`;
    // Clicks inside the popup are handled here and never reach the card's own click handling.
    modal.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ev.target === modal) { this._closeStandIn(); return; }
      const path = ev.composedPath();
      if (path.some(el => el.classList && el.classList.contains('sm-cancel'))) { this._closeStandIn(); return; }
      const row = path.find(el => el.classList && el.classList.contains('sm-row'));
      if (row) this._setStandIn(taskId, row.dataset.uid || null, owner);
    });
    this.shadowRoot.appendChild(modal);
  }

  _closeStandIn() {
    const m = this.shadowRoot.getElementById('standin-modal');
    if (m) m.remove();
  }

  _setStandIn(taskId, uid, owner) {
    this._closeStandIn();
    this._hass.callWS({ type: 'task_organizer/set_stand_in', task_id: taskId, user_id: uid })
      .then(() => {
        const name = this.users[uid || owner] || this.localize('unknown');
        this._showToast(this.localize(uid ? 'standin_saved' : 'standin_cleared', { name }));
        this._fetchData();
      })
      .catch(err => {
        console.error('Klusjesbeheer: could not change who does the task', err);
        this._showToast(String((err && err.message) || err));
      });
  }

  // --- confetti ----------------------------------------------------------------------------
  /** Small burst of confetti around a point on the screen. Lives on the page, so a redraw of the card cannot cut it off. */
  _confetti(x, y) {
    if (!document.body || !Element.prototype.animate) return;
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;';
    document.body.appendChild(layer);

    const count = 24;
    const finished = [];
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      const size = 6 + Math.random() * 5;
      const shape = i % 3;
      p.style.cssText = `position:absolute;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${shape === 1 ? size * 0.55 : size}px;` +
        `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};border-radius:${shape === 0 ? '50%' : '2px'};will-change:transform,opacity;`;
      layer.appendChild(p);

      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const dist = 55 + Math.random() * 65;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist - 12;
      const spin = (Math.random() - 0.5) * 720;
      const duration = 750 + Math.random() * 450;
      const anim = p.animate([
        { transform: 'translate(0px, 0px) rotate(0deg) scale(0.3)', opacity: 1, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)' },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin * 0.5}deg) scale(1)`, opacity: 1, offset: 0.4, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
        { transform: `translate(${dx * 1.15}px, ${dy + 60 + Math.random() * 30}px) rotate(${spin}deg) scale(0.9)`, opacity: 0 }
      ], { duration, fill: 'forwards' });
      finished.push(anim.finished.catch(() => {}));
    }
    Promise.all(finished).then(() => layer.remove());
    setTimeout(() => layer.remove(), 2500); // safety net
  }

  // --- sound -------------------------------------------------------------------------------
  _primeAudio() {
    if (this._config && this._config.sound === false) return;
    try {
      if (!this._audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this._audioCtx = new AC();
      }
      if (this._audioCtx.state === 'suspended') this._audioCtx.resume().catch(() => {});
    } catch (e) { /* no audio available */ }
  }

  _volume() {
    const v = parseFloat(this._config && this._config.sound_volume);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
  }

  _playChime() {
    const url = this._config && this._config.sound_url;
    if (url) {
      try {
        const a = new Audio(url);
        a.volume = this._volume();
        a.play().catch(() => this._synthChime());
        return;
      } catch (e) { /* fall back to the built-in chime */ }
    }
    this._synthChime();
  }

  /** A short, friendly three-note chime (C - E - G) made on the spot, so no sound file is needed. */
  _synthChime() {
    try {
      this._primeAudio();
      const ctx = this._audioCtx;
      if (!ctx) return;
      const t0 = ctx.currentTime + 0.02;
      const master = ctx.createGain();
      master.gain.value = 0.22 * this._volume();
      master.connect(ctx.destination);

      const notes = [[1046.5, 0], [1318.5, 0.085], [1568.0, 0.17], [2093.0, 0.27]];
      notes.forEach(([freq, delay], i) => {
        const last = i === notes.length - 1;
        const start = t0 + delay;
        const len = last ? 0.9 : 0.5;
        [[1, 1], [2, 0.25]].forEach(([mult, amp]) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = mult === 1 ? 'sine' : 'triangle';
          osc.frequency.value = freq * mult;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(amp * (last ? 0.7 : 1), start + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, start + len);
          osc.connect(g); g.connect(master);
          osc.start(start);
          osc.stop(start + len + 0.05);
        });
      });
    } catch (e) { /* sound is a nice extra, never an error */ }
  }
}

class KlusjesbeheerDueCardEditor extends BaseEditor {
  _defaultTitle() { return this.localize('due_title'); }
  _manageHtml() { return ''; }
  _extraHtml() {
    return `
          ${renderCheckbox({ label: this.localize('celebrate_lbl'), checked: this._config.celebrate !== false, configValue: 'celebrate' })}
          ${renderCheckbox({ label: this.localize('sound_lbl'), checked: this._config.sound !== false, configValue: 'sound' })}
          <ha-input label="${this.localize('sound_url_lbl')}" placeholder="${this.localize('sound_url_placeholder')}" value="${this._config.sound_url || ''}" configValue="sound_url" style="width: 100%;"></ha-input>`;
  }
}

try { customElements.define('task-organizer-due-card-editor', KlusjesbeheerDueCardEditor); } catch (e) { if (!e.message.includes('already been used')) { throw e; } }
try { customElements.define('task-organizer-due-card', KlusjesbeheerDueCard); } catch (e) { if (!e.message.includes('already been used')) { throw e; } }
