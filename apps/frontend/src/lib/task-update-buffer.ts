export type BufferedTaskUpdaterOptions = {
  clearRetry?: (timer: ReturnType<typeof setTimeout>) => void;
  maxRetryDelayMs?: number;
  onRetry?: (id: string, error: unknown, delayMs: number) => void;
  retryDelayMs?: number;
  scheduleRetry?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> | undefined;
};

export function createBufferedTaskUpdater<Task extends object>(
  persist: (id: string, patch: Partial<Task>) => void,
  options: BufferedTaskUpdaterOptions = {}
) {
  const pending = new Map<string, Partial<Task>>();
  const attempts = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const scheduled = new Set<string>();
  const initialDelay = options.retryDelayMs ?? 1_000;
  const maximumDelay = options.maxRetryDelayMs ?? 30_000;
  const scheduleRetry =
    options.scheduleRetry ??
    ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      return timer;
    });
  const clearRetry = options.clearRetry ?? clearTimeout;

  function schedule(id: string, error: unknown) {
    if (scheduled.has(id)) return;
    scheduled.add(id);
    const attempt = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, attempt);
    const delayMs = Math.min(initialDelay * 2 ** (attempt - 1), maximumDelay);
    options.onRetry?.(id, error, delayMs);
    const timer = scheduleRetry(() => {
      timers.delete(id);
      scheduled.delete(id);
      flush(id);
    }, delayMs);
    if (timer) timers.set(id, timer);
  }

  function flush(id: string) {
    const patch = pending.get(id);
    if (!patch) return true;

    try {
      persist(id, patch);
      pending.delete(id);
      attempts.delete(id);
      const timer = timers.get(id);
      if (timer) clearRetry(timer);
      timers.delete(id);
      scheduled.delete(id);
      return true;
    } catch (error) {
      schedule(id, error);
      return false;
    }
  }

  function update(id: string, patch: Partial<Task>) {
    pending.set(id, { ...pending.get(id), ...patch });
    if (!scheduled.has(id)) flush(id);
  }

  return {
    flush,
    pendingCount: () => pending.size,
    update
  };
}
