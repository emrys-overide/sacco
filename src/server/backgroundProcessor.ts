export interface BackgroundProcessor {
  stop(): void;
}

export function startBackgroundProcessor(task: () => Promise<void>, intervalMs = 30_000): BackgroundProcessor {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch {
      console.error('[Background Processor] Deferred task failed; durable work remains available for retry.');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
