# Подключение n8n

Портал не зовёт ComfyUI и не знает про него. Обмен всегда один и тот же:

```
браузер → портал: событие (кнопка)
портал  → n8n:    POST вебхука, в теле снимок формы
n8n     → портал: POST статуса, POST картинки
портал  → браузер: SSE, страница обновляется сама
```

Эталонная реализация — [`demo/driver.mjs`](../demo/driver.mjs). В нём ровно те же
три вызова, что делает воркфлоу, поэтому его можно читать как код воркфлоу.

## Что нужно со стороны портала

1. `PORTAL_TOKEN` из `.env` — токен записи.
2. Адрес портала, например `http://192.168.1.10:3000`.
3. Привязка события в `data/bindings.yaml`:

```yaml
- on: generation/on_click/push
  url: http://192.168.1.126:5678/webhook/gen-push
```

## Воркфлоу «Генерация» по нодам

| # | Нода | Настройки |
|---|---|---|
| 1 | **Webhook** | POST, path `gen-push`, Response Mode — *Immediately*. Портал ждёт ответа 3 с, потом повторяет (до трёх раз) |
| 2 | **Set** | `sid` = `{{ $json.body.sid }}`, `prompt` = `{{ $json.body.values.prompt }}` |
| 3 | **HTTP Request** | POST `…/api/v1/forms/generation/values/status?sid={{ $json.sid }}` — статус `running` |
| 4 | **HTTP Request** | POST `http://192.168.1.126:8288/jobs`, тело `{"workflow":"SDXL_Corp","prompt":"{{ $json.prompt }}"}` |
| 5 | **Wait** | 5 секунд |
| 6 | **HTTP Request** | GET `http://192.168.1.126:8288/jobs/{{ $json.job_id }}` |
| 7 | **IF** | `status == done` → шаг 8; `failed` или `unknown` → ошибка; иначе → шаг 5 |
| 8 | **HTTP Request** | GET `…/jobs/{{ $json.job_id }}/image`, Response Format — *File*, Output Property — `data` |
| 9 | **HTTP Request** | POST `…/api/v1/forms/generation/values/image?sid={{ $('Set').item.json.sid }}&note={{ $('Set').item.json.prompt }}`, тело — бинарный файл |
| 10 | **HTTP Request** | POST статуса `done` |

Шаги 3 и 10 отличаются только телом:

```json
{ "value": { "state": "running", "text": "рисует" } }
{ "value": { "state": "done",    "text": "готово" } }
```

Заголовки на каждом `POST` в портал:

```
Authorization: Bearer <PORTAL_TOKEN>
Content-Type: application/json
```

На шаге 9 — `Content-Type: image/png`, тело бинарное
(*Send Body → Body Content Type → n8n Binary File → Input Data Field Name: `data`*).

## Тонкости, на которых обычно ломается

- **`sid` нужно вернуть тот же.** Он приходит в событии и адресует сессию. Если
  потерять `sid`, статус и картинка уйдут в никуда: страница ничего не покажет.
- **Вебхук отвечает сразу.** Портал не ждёт n8n и не зависит от него: 3 секунды,
  три попытки, результат в журнале. Долгая синхронная работа вебхука — лишние
  ошибки в журнале.
- **Картинку отдавайте байтами.** Портал может стоять не в той же сети, что Comfy,
  поэтому ссылка на `/jobs/{id}/image` для него не всегда достижима.
- **CORS не нужен.** Браузер ходит только в портал, портал — в n8n.
- **Ответ Comfy ждать долго.** Генерация 15–31 с по данным раннера; для 1024×1024
  с 26 шагами цикл из шагов 5–7 обычно проходит за 2–3 итерации.

## Если страница «ничего не делает»

1. `GET /api/v1/log` с токеном — видно, ушло ли событие и что ответил n8n.
2. `tail -f logs/calls.jsonl` — то же в файле.
3. `curl <портал>/api/v1/forms/generation/manifest` — какие методы есть на самом деле.
4. Проверить, что в `bindings.yaml` ключ совпадает: `<slug>/<event>/<id>`, например
   `generation/on_click/push`.
5. Порт в привязке — из n8n, а не из портала.
