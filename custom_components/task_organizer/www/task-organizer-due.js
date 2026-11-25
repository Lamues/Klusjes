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

  /** Fades the entry out and lets the ones below slide up. */
  _playExit(entries) {
    const gap = 10;
    const animations = entries.map(el => {
      const h = el.offsetHeight;
      return el.animate([
        { height: `${h}px`, minHeight: `${h}px`, opacity: 1, transform: 'translateX(0) scale(1)', marginBottom: '0px' },
        { opacity: 0, transform: 'translateX(28px) scale(0.96)', offset: 0.45 },
        { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px', opacity: 0, transform: 'translateX(28px) scale(0.96)', marginBottom: `-${gap}px` }
      ], { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    });
    return Promise.all(animations.map(a => a.finished.catch(() => {})));
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
