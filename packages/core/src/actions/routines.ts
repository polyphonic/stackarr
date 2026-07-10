import { randomUUID } from 'node:crypto';
import { readJsonSetting, writeJsonSetting } from '../database';
import { auditFinished, auditStarted } from '../safety/audit';
import { redactSecrets } from '../safety/redaction';
import {
  assertNativeAppOperationSupported,
  manageNativeAppAction,
  type NativeAppName,
  readNativeAppAction
} from './apps';

export type RoutineStep = {
  kind: 'read_app' | 'manage_app';
  app: NativeAppName;
  operation: string;
  libraryId?: string;
};

export type RoutineSchedule = {
  frequency: 'daily' | 'weekly';
  time: string;
  weekday?: number;
};

export type StackarrRoutine = {
  id: string;
  name: string;
  enabled: boolean;
  steps: RoutineStep[];
  schedule?: RoutineSchedule;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'error';
};

const routinesKey = 'stackarr.agentRoutines';

export function getRoutinesAction() {
  return { routines: readRoutines(), scheduler: 'Stackarr container scheduler' };
}

export function saveRoutineAction(input: {
  id?: string;
  name: string;
  enabled?: boolean;
  steps: RoutineStep[];
  schedule?: RoutineSchedule;
}) {
  validateRoutineInput(input);
  const routines = readRoutines();
  const existing = input.id ? routines.find((routine) => routine.id === input.id) : undefined;
  if (input.id && !existing) throw new Error(`Routine ${input.id} was not found.`);
  const now = new Date().toISOString();
  const routine: StackarrRoutine = {
    id: existing?.id ?? randomUUID(),
    name: input.name.trim(),
    enabled: input.enabled ?? existing?.enabled ?? true,
    steps: input.steps.map((step) => ({ ...step })),
    ...(input.schedule ? { schedule: { ...input.schedule } } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt, lastRunStatus: existing.lastRunStatus } : {})
  };
  writeRoutines(existing ? routines.map((item) => (item.id === routine.id ? routine : item)) : [...routines, routine]);
  return { saved: true, routine };
}

export function deleteRoutineAction(input: { id: string }) {
  const routines = readRoutines();
  const next = routines.filter((routine) => routine.id !== input.id);
  if (next.length === routines.length) throw new Error(`Routine ${input.id} was not found.`);
  writeRoutines(next);
  return { deleted: true, id: input.id };
}

export async function runRoutineAction(input: { id: string }) {
  const routine = readRoutines().find((item) => item.id === input.id);
  if (!routine) throw new Error(`Routine ${input.id} was not found.`);
  return executeRoutine(routine);
}

export async function runDueRoutinesAction(now = new Date()) {
  const due = readRoutines().filter((routine) => routine.enabled && routine.schedule && isDue(routine, now));
  const results = [];
  for (const routine of due) {
    try {
      results.push(await executeRoutine(routine, 'scheduled'));
    } catch (error) {
      results.push({ routineId: routine.id, name: routine.name, status: 'error', error: safeError(error) });
    }
  }
  return { checkedAt: now.toISOString(), due: due.length, results };
}

async function executeRoutine(routine: StackarrRoutine, caller: 'mcp-local' | 'scheduled' = 'mcp-local') {
  const started = Date.now();
  const activity = await auditStarted({
    caller,
    toolName: 'stackarr_run_routine',
    category: 'automations',
    scopes: ['automations:write'],
    risk: 'write',
    inputSummary: { routineId: routine.id, name: routine.name, steps: routine.steps.length }
  });
  const results = [];
  try {
    for (const step of routine.steps) {
      const operation = { app: step.app, operation: step.operation, libraryId: step.libraryId };
      const result =
        step.kind === 'read_app' ? await readNativeAppAction(operation) : await manageNativeAppAction(operation);
      results.push({ step, status: 'success', result });
    }
    updateRoutineRun(routine.id, 'success');
    const response = { routineId: routine.id, name: routine.name, status: 'success' as const, results };
    await auditFinished(activity.id, {
      status: 'success',
      durationMs: Date.now() - started,
      resultSummary: { routineId: routine.id, steps: results.length }
    });
    return response;
  } catch (error) {
    updateRoutineRun(routine.id, 'error');
    await auditFinished(activity.id, {
      status: 'error',
      durationMs: Date.now() - started,
      error: safeError(error)
    });
    throw error;
  }
}

function readRoutines() {
  const routines = readJsonSetting<StackarrRoutine[]>(routinesKey, []);
  return Array.isArray(routines) ? routines : [];
}

function writeRoutines(routines: StackarrRoutine[]) {
  writeJsonSetting(routinesKey, redactSecrets(routines));
}

function validateRoutineInput(input: { name: string; steps: RoutineStep[]; schedule?: RoutineSchedule }) {
  if (!input.name.trim() || input.name.trim().length > 80) throw new Error('Routine name must be 1 to 80 characters.');
  if (input.steps.length < 1 || input.steps.length > 10) throw new Error('A routine must contain 1 to 10 steps.');
  for (const step of input.steps) {
    assertNativeAppOperationSupported(step.kind === 'read_app' ? 'read' : 'manage', {
      app: step.app,
      operation: step.operation,
      libraryId: step.libraryId
    });
  }
  if (input.schedule) validateSchedule(input.schedule);
}

function validateSchedule(schedule: RoutineSchedule) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time))
    throw new Error('Schedule time must use HH:MM (24-hour) format.');
  if (
    schedule.frequency === 'weekly' &&
    (!Number.isInteger(schedule.weekday) || schedule.weekday! < 0 || schedule.weekday! > 6)
  ) {
    throw new Error('Weekly schedules require weekday 0 (Sunday) through 6 (Saturday).');
  }
}

function isDue(routine: StackarrRoutine, now: Date) {
  const schedule = routine.schedule;
  if (!schedule) return false;
  validateSchedule(schedule);
  if (schedule.frequency === 'weekly' && now.getDay() !== schedule.weekday) return false;
  const [hour, minute] = schedule.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hour * 60 + minute) return false;
  return !routine.lastRunAt || localDate(new Date(routine.lastRunAt)) !== localDate(now);
}

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function updateRoutineRun(id: string, status: StackarrRoutine['lastRunStatus']) {
  const routines = readRoutines();
  const now = new Date().toISOString();
  writeRoutines(
    routines.map((routine) =>
      routine.id === id ? { ...routine, lastRunAt: now, lastRunStatus: status, updatedAt: now } : routine
    )
  );
}

function safeError(error: unknown) {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
