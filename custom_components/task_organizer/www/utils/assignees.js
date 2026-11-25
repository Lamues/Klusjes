/**
 * Returns who is currently responsible for a task.
 *
 * With fewer than two assignees this is just the assignee list (or the one-time
 * stand-in, `stand_in`, when somebody takes over a single-assignee task). With two or more
 * it is a list with exactly ONE user ID: `next_assignee` once the due date has
 * been reached, otherwise `current_assignee`, otherwise the first in the pool.
 * (Mirrors get_effective_assignees() in rotation.py.)
 *
 * @param {object} task - The task object.
 * @returns {string[]} - The responsible user IDs.
 */
export function getEffectiveAssignees(task) {
  let pool = Array.isArray(task.assignees) ? task.assignees : (task.assignees ? [task.assignees] : []);
  pool = pool.filter(Boolean);
  if (pool.length < 2) {
    // Somebody can take over a single-assignee task for one time.
    if (pool.length === 1 && task.stand_in) return [task.stand_in];
    return pool;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(task.due_date);
  due.setHours(0, 0, 0, 0);
  const isDue = !isNaN(due) && due <= today;

  let who;
  if (task.next_assignee && pool.includes(task.next_assignee) && isDue) who = task.next_assignee;
  else if (task.current_assignee && pool.includes(task.current_assignee)) who = task.current_assignee;
  else who = pool[0];
  return [who];
}

/**
 * Users chosen in the integration options ("excluded_users") never take part:
 * they are not offered as assignees and never receive points.
 *
 * @param {object} settings - The settings from task_organizer/get_data.
 * @returns {Set<string>} - The excluded user IDs.
 */
export function getExcludedUserIds(settings) {
  const list = settings && settings.excluded_users;
  if (!list) return new Set();
  return new Set((Array.isArray(list) ? list : [list]).filter(Boolean).map(String));
}

/**
 * Returns a copy of a users map ({ user_id: value }) without the excluded users.
 *
 * @param {object} users - Users map.
 * @param {object} settings - The settings from task_organizer/get_data.
 * @returns {object}
 */
export function withoutExcludedUsers(users, settings) {
  const excluded = getExcludedUserIds(settings);
  if (!excluded.size) return { ...(users || {}) };
  return Object.fromEntries(Object.entries(users || {}).filter(([uid]) => !excluded.has(uid)));
}

/**
 * The assignees of a task that can take part (excluded users removed).
 *
 * @param {object} task - The task object.
 * @param {object} settings - The settings from task_organizer/get_data.
 * @returns {string[]}
 */
export function getAssigneePool(task, settings) {
  const excluded = getExcludedUserIds(settings);
  let pool = Array.isArray(task.assignees) ? task.assignees : (task.assignees ? [task.assignees] : []);
  return pool.filter(uid => uid && !excluded.has(uid));
}
