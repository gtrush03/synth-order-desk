import { mkdir, readFile, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TASKS, type SavedState, type TaskEdit, type Status } from './model.ts';

export class StateError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const statuses = new Set(['todo', 'active', 'blocked', 'done']);
const ids = new Set(TASKS.map(task => task.id));

export function validateEdit(value: unknown): TaskEdit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StateError(400, 'Provide a task update.');
  const obj = value as Record<string, unknown>;
  if (!Object.keys(obj).length || Object.keys(obj).some(key => !['status', 'owner', 'notes'].includes(key))) throw new StateError(400, 'Only status, owner and notes can be edited.');
  if ('status' in obj && (typeof obj.status !== 'string' || !statuses.has(obj.status))) throw new StateError(400, 'Choose a valid status.');
  if ('owner' in obj && (typeof obj.owner !== 'string' || !obj.owner.trim() || obj.owner.length > 100)) throw new StateError(400, 'Owner must be between 1 and 100 characters.');
  if ('notes' in obj && (typeof obj.notes !== 'string' || obj.notes.length > 5000)) throw new StateError(400, 'Notes must be at most 5,000 characters.');
  return { ...('status' in obj ? { status: obj.status as Status } : {}), ...('owner' in obj ? { owner: (obj.owner as string).trim() } : {}), ...('notes' in obj ? { notes: obj.notes as string } : {}) };
}

export function validateState(value: unknown): SavedState {
  const state = value as SavedState;
  if (!state || state.schema !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !state.edits || typeof state.edits !== 'object' || Array.isArray(state.edits) || !Array.isArray(state.history)) throw new StateError(503, 'Saved checklist is unreadable. Preserve the file and restore a valid state.');
  for (const [id, edit] of Object.entries(state.edits)) {
    if (!ids.has(id) || !edit || typeof edit.updatedAt !== 'string') throw new StateError(503, 'Saved checklist contains an invalid task.');
    const { updatedAt: _at, ...rest } = edit;
    try { validateEdit(rest); } catch { throw new StateError(503, 'Saved checklist contains an invalid update.'); }
  }
  for (const entry of state.history) {
    if (!entry || !ids.has(entry.taskId) || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at)) || !statuses.has(entry.status) || !Array.isArray(entry.fields) || entry.fields.some(field => !['owner', 'status', 'notes'].includes(field))) throw new StateError(503, 'Saved checklist history is unreadable. The original file has been preserved.');
  }
  return state;
}

export class StateStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public path: string) {}
  async read(): Promise<SavedState> {
    try { return validateState(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, revision: 0, edits: {}, history: [] };
      if (error instanceof StateError) throw error;
      throw new StateError(503, 'Saved checklist cannot be read. The existing file has been preserved.');
    }
  }
  update(id: string, revision: number, rawEdit: unknown): Promise<SavedState> {
    const operation = this.queue.then(async () => {
      if (!ids.has(id)) throw new StateError(404, 'Task not found.');
      const edit = validateEdit(rawEdit);
      const current = await this.read();
      if (!Number.isSafeInteger(revision) || revision !== current.revision) throw new StateError(409, 'The checklist changed in another window. Refresh before saving; your draft is still here.');
      const at = new Date().toISOString();
      const next: SavedState = {
        schema: 1, revision: current.revision + 1,
        edits: { ...current.edits, [id]: { ...current.edits[id], ...edit, updatedAt: at } },
        history: [{ at, taskId: id, fields: Object.keys(edit), status: edit.status ?? current.edits[id]?.status ?? TASKS.find(task => task.id === id)!.status }, ...current.history].slice(0, 250)
      };
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.next`;
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, this.path);
      return next;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
