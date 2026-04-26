# POLU — Polymarket Trading Bot (JS/TS + Vite)

Новый репозиторий реализован с нуля как монорепо:
- `apps/server`: торговый движок + API.
- `apps/web`: веб-интерфейс на Vite + React + TypeScript.

## Что реализовано

### 1) Интеллектуальная торговля через API нейросети
- Сервис `AiAdvisor` обращается к OpenAI-compatible API (`/chat/completions`).
- Модель получает контекст (watchlist, текущая экспозиция, лимиты риска).
- Возвращает JSON-инструкции сделок, которые проходят риск-фильтр `maxExposureUsd`.

### 2) Копирование сделок другого пользователя
- Сервис `CopyTradingService` читает последние сделки адреса-цели.
- Для каждой новой сделки создается инструкция с фиксированным объемом (`copyAmountUsd`).
- Повторно уже обработанные сделки не копируются (`ignoredTradeIds`).
- Бот ждет только новые сделки.

## Важно перед боевым запуском
Текущая версия по умолчанию использует `placeOrder` как **безопасную заглушку** (симуляция), чтобы избежать случайной живой торговли.
Для production требуется:
- подписывание ордеров CLOB Polymarket,
- обработка nonce/signature,
- надежные ретраи, мониторинг и алерты,
- управление приватными ключами через безопасный secret manager.

## Быстрый старт

```bash
npm install
npm run dev -w apps/server
npm run dev -w apps/web
```

- API: `http://localhost:8080/api`
- UI: `http://localhost:5173`

## Переменные окружения (server)
Создайте `apps/server/.env`:

```env
PORT=8080
CORS_ORIGIN=http://localhost:5173
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
POLYMARKET_API_URL=https://clob.polymarket.com
POLYMARKET_PRIVATE_KEY=
POLYMARKET_PROXY_ADDRESS=
```

## Следующие шаги
1. Подключить официальный SDK/подписание CLOB-ордеров.
2. Добавить БД (PostgreSQL) для истории позиций и дедупликации не только по tradeId, но и по market/outcome.
3. Реализовать стоп-лоссы, take-profit, дневные лимиты убытка.
4. Добавить WebSocket поток рынков и поток сделок target-кошелька.
