import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

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

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Последние вызовы в памяти + файл с ротацией. Без журнала «нажал, а ничего»
 * отлаживается гаданием; после перезапуска память пуста, файл — нет.
 */
export class CallLog {
  private readonly items: LogEntry[] = [];

  constructor(
    private readonly limit = 200,
    private readonly file?: string,
  ) {
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
      } catch {
        // без файла журнал продолжит жить в памяти
      }
    }
  }

  add(entry: Omit<LogEntry, 'ts'>): void {
    const record: LogEntry = { ts: new Date().toISOString(), ...entry };
    this.items.push(record);
    if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
    this.persist(record);
  }

  tail(limit = 50): LogEntry[] {
    return this.items.slice(-limit).reverse();
  }

  private persist(record: LogEntry): void {
    if (!this.file) return;
    try {
      if (existsSync(this.file) && statSync(this.file).size > MAX_FILE_BYTES) {
        renameSync(this.file, `${this.file}.1`);
      }
      appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      // журнал на диске — удобство, а не условие работы
    }
  }
}
