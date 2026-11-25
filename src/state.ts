import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Form } from './model.js';

export type Values = Record<string, unknown>;
export type StatusValue = { state: 'idle' | 'queued' | 'running' | 'done' | 'failed'; text?: string };
export type ImageValue = { imageId: string } | null;
export type Change = { id: string; value: unknown; version: number };

/** Видимость и активность, которой управляет бэкенд во время работы. */
export type UiState = { hidden: string[]; disabled: string[] };

/** Служебный ключ в снимке состояния: в значения элементов не попадает. */
const UI_KEY = '__ui';
export const UI_CHANGE_ID = UI_KEY;

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
      case 'list':
        values[el.id] = [];
        break;
      case 'status':
        values[el.id] = { state: 'idle', text: '' } satisfies StatusValue;
        break;
      case 'label':
        // «Текст» с включённым обменом держит своё значение как остальные поля
        if (el.props.send) values[el.id] = el.props.text ?? '';
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

  constructor(
    dataDir: string,
    private readonly maxAgeDays = 30,
  ) {
    this.dir = join(dataDir, 'state');
    mkdirSync(this.dir, { recursive: true });
    this.emitter.setMaxListeners(0);
    this.cleanup();
  }

  /** Сессии копятся с каждого браузера: старые снимки убираем при старте. */
  private cleanup(): void {
    const cutoff = Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000;
    try {
      for (const file of readdirSync(this.dir)) {
        if (!file.endsWith('.json')) continue;
        const path = join(this.dir, file);
        try {
          if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
        } catch {
          // файл занят или уже убран — не мешает
        }
      }
    } catch {
      // каталога нет — чистить нечего
    }
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

  /** Сырой снимок состояния: значения элементов плюс служебный ключ видимости. */
  private valuesRef(form: Form, sid: string): Values {
    let sessions = this.byForm.get(form.slug);
    if (!sessions) {
      sessions = new Map();
      this.byForm.set(form.slug, sessions);
    }
    let values = sessions.get(sid);
    if (!values) {
      // Форма могла измениться с прошлого визита: новые элементы получают
      // начальные значения, удалённые — исчезают.
      const base = initial(form);
      const loaded = this.load(form.slug, sid);
      if (loaded) {
        for (const key of Object.keys(base)) {
          if (key in loaded) base[key] = loaded[key];
        }
      }
      values = base;
      sessions.set(sid, values);
    }
    return values;
  }

  /** Значения элементов — без служебных ключей: это то, что видит бэкенд. */
  values(form: Form, sid: string): Values {
    const raw = this.valuesRef(form, sid);
    const out: Values = {};
    for (const [id, value] of Object.entries(raw)) {
      if (id !== UI_KEY) out[id] = value;
    }
    return out;
  }

  get(form: Form, sid: string, id: string): unknown {
    return this.values(form, sid)[id];
  }

  /** Текущая видимость/активность: пустые списки, если бэкенд ещё не присылал. */
  ui(form: Form, sid: string): UiState {
    const raw = this.valuesRef(form, sid)[UI_KEY] as UiState | undefined;
    return {
      hidden: Array.isArray(raw?.hidden) ? raw.hidden : [],
      disabled: Array.isArray(raw?.disabled) ? raw.disabled : [],
    };
  }

  /** Служебное состояние видимости — только для внутренней работы. */
  setUi(form: Form, sid: string, patch: Partial<UiState>): UiState {
    const raw = this.valuesRef(form, sid);
    const current = this.ui(form, sid);
    const next: UiState = {
      hidden: patch.hidden ?? current.hidden,
      disabled: patch.disabled ?? current.disabled,
    };
    raw[UI_KEY] = next;
    this.version += 1;
    const change: Change = { id: UI_CHANGE_ID, value: next, version: this.version };
    this.persist(form.slug, sid, raw);
    this.emitter.emit(this.key(form.slug, sid), change);
    return next;
  }

  /** Бэкенд включает/выключает один элемент, не трогая остальные. */
  setUiElement(
    form: Form,
    sid: string,
    id: string,
    patch: { hidden?: boolean; disabled?: boolean },
  ): UiState {
    const current = this.ui(form, sid);
    const hidden = new Set(current.hidden);
    const disabled = new Set(current.disabled);

    if (patch.hidden === true) hidden.add(id);
    else if (patch.hidden === false) hidden.delete(id);
    if (patch.disabled === true) disabled.add(id);
    else if (patch.disabled === false) disabled.delete(id);

    return this.setUi(form, sid, { hidden: [...hidden], disabled: [...disabled] });
  }

  set(form: Form, sid: string, id: string, value: unknown): Change {
    const values = this.valuesRef(form, sid);
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

  /** Удаление страницы: убираем значения всех её сессий и снимки с диска. */
  removeForm(slug: string): void {
    this.byForm.delete(slug);
    try {
      for (const file of readdirSync(this.dir)) {
        if (file.startsWith(`${slug}.`) && file.endsWith('.json')) {
          try {
            unlinkSync(join(this.dir, file));
          } catch {
            // файл уже убран
          }
        }
      }
    } catch {
      // каталога нет — чистить нечего
    }
  }

  subscribe(slug: string, sid: string, listener: (change: Change) => void): () => void {
    const key = this.key(slug, sid);
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }
}
