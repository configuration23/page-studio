# Эксплуатация

Как поставить портал на Linux-хост в Docker, обновить, забэкапить и починить.

## Что нужно

- Linux, Docker 24+ и `docker compose`;
- ~200 МБ диска на образ, плюс место под картинки;
- домен или адрес в сети, если портал нужен не только с этой машины.

## Установка

```bash
git clone https://github.com/configuration23/page-studio.git
cd page-studio
cp .env.example .env
```

В `.env` обязательно задать:

| Переменная | Зачем |
|---|---|
| `PORTAL_TOKEN` | токен записи для n8n; без него сервер не стартует |
| `ADMIN_PASSWORD` | вход в админку; без него админка выключена (503) |
| `ADMIN_USER` | логин админа, по умолчанию `admin` |

Дальше:

```bash
# каталоги данных пишет пользователь node (uid 1000)
sudo mkdir -p data/state data/generations logs
sudo chown -R 1000:1000 data logs

docker compose -f docker/compose.example.yaml up -d --build
curl -s http://127.0.0.1:3000/health
```

Портал слушает только `127.0.0.1:3000`. Наружу — через nginx
([пример](../docker/nginx.conf.example)): basic auth на `/admin`, TLS,
`proxy_read_timeout 300s` и `proxy_buffering off` для SSE.

## Проверка после установки

```bash
curl -s http://127.0.0.1:3000/health
curl -s -u admin:пароль http://127.0.0.1:3000/api/v1/admin/forms
curl -s http://127.0.0.1:3000/api/v1/forms/generation/manifest
```

Демо-драйвер в контейнере не нужен: он существует, чтобы проверить страницу без
n8n. Для локальной проверки — `pnpm demo` на машине разработчика.

## Бэкап и восстановление

Всё состояние — два каталога: `data/` (формы, значения сессий, картинки) и `logs/`.

```bash
# бэкап
tar czf backup-$(date +%F).tgz data logs .env

# восстановление
tar xzf backup-2026-11-22.tgz
sudo chown -R 1000:1000 data logs
docker compose -f docker/compose.example.yaml restart
```

Восстановление проверяется на копии: поднять второй экземпляр на другом порту
с распакованным `data/` и открыть страницы. Без такой проверки бэкап — это
надежда, а не бэкап.

## Обновление и откат

```bash
git pull
docker compose -f docker/compose.example.yaml up -d --build
curl -s http://127.0.0.1:3000/health
```

Откат — на предыдущий тег или коммит:

```bash
git checkout v0.2.0        # или конкретный коммит
docker compose -f docker/compose.example.yaml up -d --build
```

Формат `data/forms/*.yaml` меняется только вперёд; новая версия читает старые
формы, обратное не гарантируется. Поэтому перед обновлением — бэкап.

## Логи и диагностика

| Что | Где |
|---|---|
| Вызовы методов, ошибки отправки в n8n | `logs/calls.jsonl`, `GET /api/v1/log` (с токеном) |
| Вывод контейнера | `docker logs -f <контейнер>` |
| Здоровье | `GET /health`, `docker inspect --format '{{.State.Health.Status}}'` |

## Частые проблемы

| Симптом | Причина |
|---|---|
| `/admin` отдаёт 401 после ввода пароля | в `.env` другой `ADMIN_PASSWORD`; контейнер не перезапущен |
| `/admin` отдаёт 503 | `ADMIN_PASSWORD` не задан |
| `n8n` получает 401 при записи | не тот `PORTAL_TOKEN` или заголовок не `Bearer` |
| Картинки не сохраняются | у каталога `data/generations` нет прав для uid 1000 |
| Страница не обновляется сама | nginx буферизует SSE: нужен `proxy_buffering off` |
| Долгая генерация обрывается | `proxy_read_timeout` меньше времени работы n8n |
| Событие не доходит до n8n | нет привязки в `data/bindings.yaml` или ключ не совпадает с `<slug>/<event>/<id>` |

## Ротация и обслуживание

- журнал вызовов ротируется сам при 2 МБ (`calls.jsonl.1`);
- снимки сессий старше 30 дней удаляются при старте;
- картинки не чистятся: решать, что удалять, — владельцу. Каталог смотреть
  через `du -sh data/generations`.
