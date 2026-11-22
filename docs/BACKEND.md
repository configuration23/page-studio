# Подключение бэкенда

Портал не привязан к конкретному инструменту. Бэкенд — это любой процесс, который
умеет две вещи:

1. принять `POST` с событием от портала;
2. сходить в HTTP API портала, чтобы прочитать значение, записать статус или
   положить картинку.

Подойдёт n8n, FastAPI, Go-сервис, PHP-скрипт, Make, cron с curl — что угодно.
В примерах ниже — n8n, потому что он удобен для домашних сценариев, но контракт
от него не зависит.

## Как устроен обмен

```
браузер → портал: событие (нажатие, изменение поля)
портал  → бэкенд: POST на вебхук, в теле снимок формы
бэкенд  → портал: POST статуса, POST картинки
портал  → браузер: SSE, страница обновляется сама
```

Портал не вызывает бэкенд нигде, кроме одного места — события. Всё остальное
бэкенд делает сам.

## Что нужно со стороны портала

1. `PORTAL_TOKEN` из `.env` — токен на запись.
2. Адрес портала, например `http://192.168.1.10:3000`.
3. Привязка события в `data/bindings.yaml`:

```yaml
- on: generation/on_click/push
  url: http://192.168.1.10:5678/webhook/gen-push
```

## Что приходит в событии

```json
{
  "page": "generation",
  "element": "push",
  "event": "on_click",
  "sid": "a1b2c3d4e5f6",
  "ts": "2026-11-22T09:00:00.000Z",
  "values": { "prompt": "кот-астронавт", "status": { "state": "idle" } }
}
```

`values` — снимок всей формы на момент события, чтобы бэкенду не делать лишних
запросов. `sid` нужно вернуть обратно: он адресует сессию.

## Три вызова, которые делает бэкенд

Все — с заголовком `Authorization: Bearer <PORTAL_TOKEN>`.

```bash
PORTAL=http://192.168.1.10:3000
SID=a1b2c3d4e5f6

# 1. статус
curl -X POST "$PORTAL/api/v1/forms/generation/values/status?sid=$SID" \
  -H "authorization: Bearer $PORTAL_TOKEN" \
  -H "content-type: application/json" \
  -d '{"value":{"state":"running","text":"работаю"}}'

# 2. картинка — байтами, не ссылкой
curl -X POST "$PORTAL/api/v1/forms/generation/values/image?sid=$SID&note=промпт" \
  -H "authorization: Bearer $PORTAL_TOKEN" \
  -H "content-type: image/png" \
  --data-binary @result.png

# 3. готово
curl -X POST "$PORTAL/api/v1/forms/generation/values/status?sid=$SID" \
  -H "authorization: Bearer $PORTAL_TOKEN" \
  -H "content-type: application/json" \
  -d '{"value":{"state":"done","text":"готово"}}'
```

Чтение значений — `GET .../values/<id>?sid=...`; список методов страницы —
`GET /api/v1/forms/<slug>/manifest`.

## Пример: n8n

| # | Нода | Настройки |
|---|---|---|
| 1 | **Webhook** | POST, path `gen-push`, Response Mode — *Immediately*. Портал ждёт ответа 3 с, потом повторяет (до трёх раз) |
| 2 | **Set** | `sid` = `{{ $json.body.sid }}`, `prompt` = `{{ $json.body.values.prompt }}` |
| 3 | **HTTP Request** | POST статуса `running` |
| 4 | **HTTP Request** | вызов своего генератора |
| 5 | **Wait** | пауза и опрос готовности |
| 6 | **HTTP Request** | получить результат, Response Format — *File*, Output Property — `data` |
| 7 | **HTTP Request** | POST картинки: *Body Content Type → n8n Binary File*, поле `data`, `Content-Type: image/png` |
| 8 | **HTTP Request** | POST статуса `done` |

Ровно эти шаги делает `demo/driver.mjs` — он и есть эталон контракта, только вместо
генератора рисует заглушку.

## Тонкости, на которых обычно ломается

- **`sid` нужно вернуть тот же.** Он приходит в событии и адресует сессию. Потеряли
  `sid` — статус и картинка уйдут в никуда, страница ничего не покажет.
- **Вебхук отвечает сразу.** Портал не ждёт бэкенд: 3 секунды, три попытки, итог в
  журнале. Долгая синхронная работа вебхука — лишние ошибки в журнале.
- **Картинку отдавайте байтами.** Портал может стоять не в той же сети, что
  генератор, поэтому ссылка на файл для него не всегда достижима.
- **CORS не нужен.** Браузер ходит только в портал, портал — только в бэкенд.
- **Долгая работа — это нормально.** Опрос готовности на стороне бэкенда; портал
  ничего не ждёт и не опрашивает.

## Проверка без своего бэкенда

```bash
pnpm demo
```

Демо-драйвер слушает `http://127.0.0.1:7100/webhook/gen-push`, читает манифест
страницы и делает те же три вызова: статус, картинка, статус. Если страница
работает с ним — контракт собран верно.

В Docker драйвер поднимается рядом с порталом и слушает все интерфейсы:

```bash
docker run -d --name ps-demo --restart unless-stopped \
  --network docker_default \
  -e DRIVER_HOST=0.0.0.0 \
  -e PORTAL_URL=http://page-studio:3000 \
  -e PORTAL_TOKEN="$(grep '^PORTAL_TOKEN=' .env | cut -d= -f2)" \
  docker-page-studio node demo/driver.mjs
```

Привязки тогда смотрят на `http://ps-demo:7100/webhook/gen-push`.

## Если страница «ничего не делает»

1. `GET /api/v1/log` с токеном — ушло ли событие и что ответил бэкенд.
2. `tail -f logs/calls.jsonl` — то же в файле.
3. `GET /api/v1/forms/<slug>/manifest` — какие методы есть на самом деле.
4. Проверить ключ привязки: `<slug>/<event>/<id>`, например `generation/on_click/push`.
5. Порт в привязке — тот, где слушает бэкенд, а не портал.
