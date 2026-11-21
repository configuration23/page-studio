export type LogEntry = {
  ts: string;
  kind: 'value' | 'event' | 'push' | 'error';
  page: string;
  name: string;
  sid?: string;
  ok: boolean;
  note?: string;
  ms?: number;
};

/** Последние вызовы: без него «нажал, а ничего» отлаживается гаданием. */
export class CallLog {
  private readonly items: LogEntry[] = [];

  constructor(private readonly limit = 200) {}

  add(entry: Omit<LogEntry, 'ts'>): void {
    this.items.push({ ts: new Date().toISOString(), ...entry });
    if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
  }

  tail(limit = 50): LogEntry[] {
    return this.items.slice(-limit).reverse();
  }
}
