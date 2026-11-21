import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Form } from './model.js';

export type Values = Record<string, unknown>;
export type StatusValue = { state: 'idle' | 'queued' | 'running' | 'done' | 'failed'; text?: string };
export type ImageValue = { imageId: string } | null;
export type Change = { id: string; value: unknown; version: number };

function initial(form: Form): Values {
  const values: Values = {};
  for (const el of form.elements) {
    const p = el.props;
    switch (el.kind) {
      case 'edit':
      case 'memo':
        values[el.id] = p.value ?? '';
        break;
      case 'combo':
        values[el.id] = p.value ?? p.options?.[0] ?? '';
        break;
      case 'check':
        values[el.id] = false;
        break;
      case 'image':
        values[el.id] = null;
        break;
      case 'status':
        values[el.id] = { state: 'idle', text: '' } satisfies StatusValue;
        break;
      default:
        break;
    }
  }
  return values;
}

/**
 * Значения полей по парам (форма, сессия). Источник истины — сервер, чтобы
 * перезагрузка страницы посреди генерации не теряла состояние.
 */
export class StateStore {
  private readonly dir: string;
  private readonly byForm = new Map<string, Map<string, Values>>();
  private readonly emitter = new EventEmitter();
  private version = 0;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'state');
    mkdirSync(this.dir, { recursive: true });
    this.emitter.setMaxListeners(0);
  }

  private key(slug: string, sid: string): string {
    return `${slug}:${sid}`;
  }

  private load(slug: string, sid: string): Values | null {
    const file = join(this.dir, `${slug}.${sid}.json`);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Values;
    } catch {
      return null;
    }
  }

  values(form: Form, sid: string): Values {
    let sessions = this.byForm.get(form.slug);
    if (!sessions) {
      sessions = new Map();
      this.byForm.set(form.slug, sessions);
    }
    let values = sessions.get(sid);
    if (!values) {
      values = this.load(form.slug, sid) ?? initial(form);
      sessions.set(sid, values);
    }
    return values;
  }

  get(form: Form, sid: string, id: string): unknown {
    return this.values(form, sid)[id];
  }

  set(form: Form, sid: string, id: string, value: unknown): Change {
    const values = this.values(form, sid);
    if (!(id in values)) {
      throw new Error(`в форме «${form.slug}» нет значения «${id}»`);
    }
    values[id] = value;
    this.version += 1;
    const change: Change = { id, value, version: this.version };
    this.persist(form.slug, sid, values);
    this.emitter.emit(this.key(form.slug, sid), change);
    return change;
  }

  private persist(slug: string, sid: string, values: Values): void {
    try {
      writeFileSync(join(this.dir, `${slug}.${sid}.json`), JSON.stringify(values), 'utf8');
    } catch (err) {
      // состояние в памяти важнее снимка на диске
      console.error('состояние не сохранилось:', (err as Error).message);
    }
  }

  /** Отправить изменение без записи в состояние: так обновляется галерея. */
  publish(slug: string, sid: string, change: Change): void {
    this.version += 1;
    this.emitter.emit(this.key(slug, sid), { ...change, version: this.version });
  }

  subscribe(slug: string, sid: string, listener: (change: Change) => void): () => void {
    const key = this.key(slug, sid);
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }
}
