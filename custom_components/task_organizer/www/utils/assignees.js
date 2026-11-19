/**
 * Returns who is currently responsible for a task.
 *
 * With fewer than two assignees this is just the assignee list. With two or more
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
  if (pool.length < 2) return pool;

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
