# POLU — Polymarket Trading Bot (JS/TS + Vite)

Монорепо:
- `apps/server`: торговый движок + API.
- `apps/web`: UI-консоль на Vite + React + TypeScript.

## Реализовано

### 1) Интеллектуальная торговля через API нейросети
- `AiAdvisor` запрашивает OpenAI-compatible `/chat/completions`.
- Модель получает контекст рынка и лимиты риска.
- Ответ преобразуется в инструкции сделок c источником `AI`.
- При 401/403 от AI API бот не падает: AI-сигналы временно пропускаются, copy-trading продолжает работать.

### 2) Копирование сделок другого пользователя
- `CopyTradingService` читает последние трейды target wallet.
- Копирует фиксированным объёмом (`copyAmountUsd`).
- Копирование сделок использует публичный feed трейдов и не блокируется, даже если private balance endpoint временно недоступен.
- Повторно не копирует:
  - уже обработанные `tradeId`,
  - уже купленную комбинацию `marketId:outcome:side`.

### 3) Polymarket Proxy / Magic login (signature_type=1)
- В настройках добавлены:
  - `signatureType` (0/1/2),
  - `funder` (важно для `signature_type=1`),
  - `executionMode` (`SIMULATION` / `LIVE`).
- Для proxy/email login используйте `signatureType=1` и укажите адрес `funder`.

### 4) Устойчивость к 401 и загрузка баланса
- Ошибки Polymarket API больше не роняют процесс.
- Если API вернул 401 для трейдов или 401/404 для баланса — бот продолжает работу без падения.
- Баланс сначала читается через `ClobClient.getBalanceAllowance({asset_type: "COLLATERAL"})`; REST fallback используется только как резерв.
- Если указан `POLYMARKET_PRIVATE_KEY`, бот автоматически делает `createOrDeriveApiKey()` и использует derived creds.

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
POLYGON_CHAIN_ID=137
POLYMARKET_PRIVATE_KEY=
POLYMARKET_PROXY_ADDRESS=
POLYMARKET_SIGNATURE_TYPE=1
POLYMARKET_API_KEY=
POLYMARKET_API_SECRET=
POLYMARKET_API_PASSPHRASE=
```

Если есть `POLYMARKET_PRIVATE_KEY`, поля `POLYMARKET_API_KEY/SECRET/PASSPHRASE` можно не задавать — бот попробует derivation автоматически.

## Windows note (Rollup optional dependency)
Если на Windows при `npm run dev -w apps/web` появляется ошибка вида
`Cannot find module @rollup/rollup-win32-x64-msvc`,
теперь в `predev/prebuild` запускается авто-проверка и доустановка нужного пакета.

Если проблема осталась, выполните вручную:
```bash
npm install --include=optional
```

## Если после смены `POLYMARKET_PRIVATE_KEY` «сломался» баланс/ордера

Чаще всего проблема в несоответствии `signature_type` и `funder` (proxy address),
или в том, что остались старые `POLYMARKET_API_KEY/SECRET/PASSPHRASE` от прошлого ключа.

### Быстрая диагностика

```bash
npm run check:poly -w apps/server
```

Скрипт:
- печатает `signer`, `funder`, `signature_type`,
- делает `createOrDeriveApiKey()`,
- вызывает `getBalanceAllowance({ asset_type: "COLLATERAL" })`.

Если скрипт показывает баланс, а в web UI баланс всё ещё `0`/`N/A`:
- проверьте `Sig type` и `Funder` в UI Settings и нажмите **Save**;
- удалите устаревший `settings.json` в корне проекта и перезапустите backend.

Если баланс есть, но copy-trading не копирует сделки и в логах есть `eth_getLogs ... 429`:
- это лимит RPC (например Alchemy CU/s);
- бот теперь сам добавляет retry/backoff и уменьшает окно сканирования при большом лаге;
- при частых 429 лучше перейти на более быстрый RPC тариф/ключ.

### Рекомендуемая конфигурация

```env
POLYMARKET_PRIVATE_KEY=0x...
POLYMARKET_SIGNATURE_TYPE=1
POLYMARKET_PROXY_ADDRESS=0x...   # обязательно для proxy/magic

# после смены private key лучше очистить статические API creds,
# чтобы бот использовал derivation от нового ключа:
POLYMARKET_API_KEY=
POLYMARKET_API_SECRET=
POLYMARKET_API_PASSPHRASE=
```

### Как оформляется ордер в этом проекте

В `LIVE` режиме бот делает:
1. `GET /book` и берёт лучшую цену,
2. считает `size = amountUsd / price`,
3. `client.createOrder({ tokenID, price, size, side })`,
4. `client.postOrder(signedOrder)`.

Если `executionMode=SIMULATION`, ордер в сеть не отправляется.
