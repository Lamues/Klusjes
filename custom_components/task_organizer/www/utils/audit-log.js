/**
 * Renders the history (audit log) of one task as HTML, in the language of Home Assistant.
 * Used by the task list card and by the task edit dialog, so both look and read the same.
 *
 * @param {object[]} taskHistory - Entries from task_organizer/get_task_audit_log.
 * @param {object} users - { user_id: display name }.
 * @param {function} t - localize(key, replace) of the calling element (card dictionary).
 * @param {object} hass - Home Assistant object (for the date language).
 * @returns {string} HTML.
 */
export function renderAuditLogHtml(taskHistory, users, t, hass) {
  if (!taskHistory || taskHistory.length === 0) {
    return `<div style="text-align: center; color: var(--secondary-text-color); padding: 16px;">${t('no_history')}</div>`;
  }

  const lang = (hass && hass.language) || undefined;
  const nameOf = (uid) => (uid && users && users[uid]) ? users[uid] : (uid || null);
  const fieldName = (key) => {
    const label = t(`hist_field_${key}`);
    return label === `hist_field_${key}` ? key : label;
  };
  const box = (inner) => `<div style="margin-top: 8px; font-size: 12px; background: rgba(0,0,0,0.1); padding: 6px; border-radius: 4px;">${inner}</div>`;
  const line = (inner, style = '') => `<div style="margin-bottom: 2px;${style}">• ${inner}</div>`;

  let html = '<div class="history-timeline">';
  taskHistory.forEach(entry => {
    let dateStr = t('unknown');
    if (entry.timestamp) {
      try { dateStr = new Date(entry.timestamp).toLocaleString(lang); } catch (e) { dateStr = new Date(entry.timestamp).toLocaleString(); }
    }
    const userName = nameOf(entry.user_id);

    let title = '';
    let detailsHtml = '';
    let icon = '';
    let color = '';

    if (entry.action === 'created') {
      title = t('hist_created');
      icon = 'mdi:plus-circle';
      color = 'var(--info-color, #2196f3)';
    } else if (entry.action === 'edited') {
      title = t('hist_edited');
      icon = 'mdi:text-box-edit-outline';
      color = 'var(--primary-color, #03a9f4)';

      const changes = entry.details?.changes;
      if (changes && Object.keys(changes).length > 0) {
        let inner = '';
        for (const [key, diff] of Object.entries(changes)) {
          const label = fieldName(key);
          if (key === 'subtasks') {
            const oldSubtasks = diff.old || [];
            const newSubtasks = diff.new || [];
            const completed = [];
            const added = [];
            newSubtasks.forEach(st => {
              const oldSt = oldSubtasks.find(o => o.title === st.title);
              if (oldSt) {
                if (st.done && !oldSt.done) completed.push(st.title);
              } else {
                added.push(st.title);
              }
            });
            if (completed.length || added.length) {
              completed.forEach(stTitle => {
                inner += line(`<b>${t('hist_subtask')}:</b> <s>${stTitle}</s> ${t('hist_subtask_done')} <ha-icon icon="mdi:check-circle" style="--mdc-icon-size: 12px; margin-left: 2px;"></ha-icon>`, ' color: var(--success-color, #4caf50);');
              });
              if (completed.length && Object.keys(changes).length === 1 && added.length === 0) {
                title = userName ? t('hist_subtasks_done_by', { name: userName }) : t('hist_subtasks_done');
                icon = 'mdi:check-circle-outline';
                color = 'var(--success-color, #4caf50)';
              }
              added.forEach(stTitle => {
                inner += line(`<b>${t('hist_subtask')}:</b> ${stTitle} ${t('hist_subtask_added')}`);
              });
            } else {
              inner += line(`<b>${label}</b> ${t('hist_changed')}`);
            }
          } else if (key === 'stand_in') {
            title = diff.new ? t('hist_stand_in', { name: nameOf(diff.new) }) : t('hist_stand_in_cleared');
            icon = 'mdi:account-switch';
          } else if (key === 'images' || key === 'assignees' || key === 'current_assignee' || key === 'schedule') {
            inner += line(`<b>${label}</b> ${t('hist_changed')}`);
          } else {
            const oldVal = diff.old !== null && diff.old !== undefined && diff.old !== '' ? String(diff.old) : t('hist_empty');
            const newVal = diff.new !== null && diff.new !== undefined && diff.new !== '' ? String(diff.new) : t('hist_empty');
            inner += line(`<b>${label}</b>: <s>${oldVal}</s> → ${newVal}`);
          }
        }
        if (inner) detailsHtml = box(inner);
      }
    } else if (entry.action === 'completed') {
      const usersWithPoints = entry.details?.users_with_points;
      if (usersWithPoints && Object.keys(usersWithPoints).length > 1) {
        title = t('hist_completed_together');
        let inner = '';
        for (const [uId, pts] of Object.entries(usersWithPoints)) {
          inner += line(`<b>${nameOf(uId)}</b>: +${pts} ${t('points')}`);
        }
        detailsHtml = box(inner);
      } else {
        // Show who got the points (that is who did the task), otherwise who ticked it off.
        const receiver = usersWithPoints && Object.keys(usersWithPoints).length === 1 ? nameOf(Object.keys(usersWithPoints)[0]) : userName;
        title = receiver ? t('hist_completed_by', { name: receiver }) : t('hist_completed');
        if (entry.details?.points) {
          detailsHtml = `<div class="timeline-points" style="color: var(--success-color, #4caf50)">+${entry.details.points} ${t('points')}</div>`;
        }
      }
      icon = 'mdi:check-circle';
      color = 'var(--success-color, #4caf50)';
    } else {
      title = t('hist_action', { action: entry.action });
      icon = 'mdi:information';
      color = 'var(--secondary-text-color)';
    }

    html += `
            <div class="timeline-item" style="display: flex; gap: 16px; position: relative; padding-bottom: 16px;">
                <div class="timeline-marker" style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--card-background-color); display: flex; align-items: center; justify-content: center; z-index: 1; background-color: ${color}; flex-shrink: 0;">
                    <ha-icon icon="${icon}" style="--mdc-icon-size: 16px; color: white;"></ha-icon>
                </div>
                <div class="timeline-content" style="flex: 1; min-width: 0;">
                    <div class="timeline-date" style="font-size: 11px; color: var(--secondary-text-color); margin-bottom: 4px;">${dateStr}${userName ? ' • ' + userName : ''}</div>
                    <div class="timeline-title" style="font-size: 14px; font-weight: 500; color: var(--primary-text-color);">${title}</div>
                    ${detailsHtml}
                </div>
            </div>
        `;
  });
  html += '</div>';
  return html;
}

/** HTML for the "loading" state. */
export function renderAuditLogLoading(t) {
  return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; color: var(--secondary-text-color);">
            <ha-circular-progress active size="medium"></ha-circular-progress>
            <div style="margin-top: 8px; font-size: 14px;">${t('hist_loading')}</div>
        </div>
    `;
}

/** HTML for the "could not load" state. */
export function renderAuditLogError(t) {
  return `<div style="text-align: center; color: var(--error-color); padding: 16px;">${t('hist_load_error')}</div>`;
}
