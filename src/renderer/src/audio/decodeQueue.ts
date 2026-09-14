type Task<T> = { key: string; priority: number; run: () => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

// Slots cover the complete read/decode operation, so waiting jobs hold no file buffers.
export class DecodeQueue {
  private running = 0;
  private waiting: Task<unknown>[] = [];
  private pending = new Map<string, Promise<unknown>>();
  constructor(private readonly concurrency = 2) {}

  run<T>(key: string, run: () => Promise<T>, priority = 0): Promise<T> {
    const current = this.pending.get(key);
    if (current) {
      this.promote(key, priority);
      return current as Promise<T>;
    }
    const promise = new Promise<T>((resolve, reject) => {
      this.waiting.push({ key, priority, run, resolve, reject } as Task<unknown>);
    });
    this.pending.set(key, promise);
    this.pump();
    return promise;
  }

  promote(key: string, priority: number): void {
    const task = this.waiting.find(task => task.key === key);
    if (task) task.priority = Math.max(task.priority, priority);
  }

  private pump(): void {
    this.waiting.sort((a, b) => b.priority - a.priority);
    while (this.running < this.concurrency && this.waiting.length) {
      const task = this.waiting.shift()!;
      this.running++;
      const finish = () => {
        this.pending.delete(task.key);
        this.running--;
        this.pump();
      };
      void Promise.resolve().then(task.run).then(value => {
        finish();
        task.resolve(value);
      }, error => {
        finish();
        task.reject(error);
      });
    }
  }
}

export const decodeQueue = new DecodeQueue(2);
