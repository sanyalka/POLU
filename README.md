# POLU — Polymarket Trading Bot (JS/TS + Vite)

Монорепо:
- `apps/server`: торговый движок + API.
- `apps/web`: новый UI-консоль на Vite + React + TypeScript.

## Реализовано

### 1) Интеллектуальная торговля через API нейросети
- `AiAdvisor` запрашивает OpenAI-compatible `/chat/completions`.
- Модель получает контекст рынка и лимиты риска.
- Ответ преобразуется в инструкции сделок c источником `AI`.

### 2) Копирование сделок другого пользователя
- `CopyTradingService` читает последние трейды target wallet.
- Копирует фиксированным объёмом (`copyAmountUsd`).
- Повторно не копирует:
  - уже обработанные `tradeId`,
  - уже купленную комбинацию `marketId:outcome:side`.

### 3) Polymarket Proxy / Magic login (signature_type=1)
- В настройках добавлены:
  - `signatureType` (0/1/2),
  - `funder` (важно для `signature_type=1`),
  - `executionMode` (`SIMULATION` / `LIVE`).
- Для proxy/email login используйте `signatureType=1` и укажите адрес `funder`.

## Безопасность
- По умолчанию `executionMode=SIMULATION`.
- Для LIVE-торговли обязательно проверьте endpoint/формат ордера вашей интеграции Polymarket CLOB.

## Запуск

```bash
npm install
npm run dev -w apps/server
npm run dev -w apps/web
```

- API: `http://localhost:8080/api`
- UI: `http://localhost:5173`

Если backend не на localhost:8080, задайте `VITE_API_URL` для web-приложения (например, `VITE_API_URL=http://127.0.0.1:8080/api`).

## .env (apps/server/.env)

```env
PORT=8080
CORS_ORIGIN=http://localhost:5173
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
POLYMARKET_API_URL=https://clob.polymarket.com
POLYMARKET_PRIVATE_KEY=
POLYMARKET_PROXY_ADDRESS=
POLYMARKET_SIGNATURE_TYPE=1
```
