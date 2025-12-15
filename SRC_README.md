# SRC - TypeScript Telegram Bot (Cris Mailer)

Telegram бот на TypeScript для автоматизации email рассылок через Kleinanzeigen с использованием Bun runtime и Grammy framework.

---

## 📁 Структура проекта

```
src/
├── index.ts                   # Точка входа - запуск бота, API сервера, EmailStream
├── bot.ts                     # Инициализация Grammy бота, middlewares, плагины
├── config.ts                  # Загрузка конфигурации из config.ini
│
├── emailSender.ts             # Логика отправки email через прокси (очередь рассылки)
├── emailQueue.ts              # Подбор email по именам через Kleinanzeigen API
├── emailStream.ts             # IMAP мониторинг входящих писем (ImapFlow)
├── parseQueue.ts              # Обработка очереди парсинга файлов
│
├── api/
│   └── server.ts              # REST API сервер (Bun.serve) для внешнего управления
│
├── commands/                  # Telegram команды бота
│   ├── admin.ts               # Команды для админов (/admin, /adduser)
│   ├── start.ts               # /start - приветствие
│   ├── send.ts                # /send - запуск рассылки
│   ├── stop.ts                # /stop - остановка рассылки
│   ├── status.ts              # /status - статус рассылки
│   ├── config.ts              # /config - настройки пользователя
│   ├── test.ts                # /test - тест одной отправки
│   ├── testall.ts             # /testall - тест всех email
│   └── testhtml.ts            # /testhtml - тест HTML шаблонов
│
├── conversations/             # Grammy conversations - диалоги с пользователем
│   ├── emailAdd.ts            # Добавление email
│   ├── emailEdit.ts           # Редактирование email
│   ├── proxyAdd.ts            # Добавление прокси
│   ├── proxyEdit.ts           # Редактирование прокси
│   ├── presetAdd.ts           # Добавление пресета (текст письма)
│   ├── presetEdit.ts          # Редактирование пресета
│   ├── smartPresetAdd.ts      # Добавление умного пресета
│   ├── smartPresetEdit.ts     # Редактирование умного пресета
│   ├── topicAdd.ts            # Добавление топика
│   ├── topicEdit.ts           # Редактирование топика
│   ├── sendEmail.ts           # Отправка email через диалог
│   ├── htmlTemplateGet.ts     # Получение HTML шаблона
│   ├── intervalEdit.ts        # Редактирование интервала рассылки
│   ├── apiKeyEdit.ts          # Редактирование API ключей
│   ├── profileIdEdit.ts       # Редактирование Profile ID
│   ├── priorityEdit.ts        # Редактирование приоритета
│   ├── spoofNameEdit.ts       # Редактирование spoof имени
│   ├── nickCheck.ts           # Проверка никнейма
│   └── userManagement.ts      # Управление пользователями
│
├── handlers/                  # Обработчики событий бота
│   ├── adminPanel.ts          # Админ панель
│   ├── adminCallbacks.ts      # Коллбэки админ панели
│   ├── sendEmail.ts           # Обработка отправки email
│   ├── settings.ts            # Настройки пользователя
│   ├── htmlTemplates.ts       # HTML шаблоны
│   ├── fastAdd.ts             # Быстрое добавление данных
│   └── nickCheck.ts           # Проверка никнейма
│
├── callbacks/                 # Callback query обработчики
│   ├── getMail.ts             # Получение email, генерация ссылок
│   └── index.ts               # Экспорт всех коллбэков
│
├── menus/                     # Inline клавиатуры (меню)
│   ├── settings/              # Меню настроек
│   └── index.ts               # Экспорт всех меню
│
├── middlewares/               # Grammy middlewares
│   ├── userMiddleware.ts      # Проверка пользователя в БД
│   ├── roleMiddleware.ts      # Проверка роли пользователя
│   └── ReplyOrEdit.ts         # Умный ответ/редактирование сообщений
│
├── db/                        # База данных (SQLite + Drizzle ORM)
│   ├── index.ts               # Подключение к БД
│   ├── schema.ts              # Схема таблиц (users, emails, proxies, presets, etc.)
│   └── queries/               # Репозитории для работы с БД
│       ├── user.ts            # UserRepo
│       ├── email.ts           # EmailRepo
│       ├── emailMessage.ts    # EmailMsgRepo
│       ├── proxy.ts           # ProxyRepo
│       ├── preset.ts          # PresetRepo
│       ├── smartPreset.ts     # SmartPresetRepo
│       ├── adverts.ts         # AdvertsRepo
│       ├── topic.ts           # TopicRepo
│       └── keys.ts            # KeysRepo
│
├── webhooks/                  # Webhooks для интеграции с auto_answer
│   └── manager.ts             # Отправка webhooks (новые письма, завершение подбора)
│
├── utils/                     # Утилиты
│   ├── sendEmail.ts           # Отправка email через nodemailer + SOCKS5
│   ├── proxyForm.ts           # Парсинг и форматирование прокси
│   ├── blacklistChecker.ts    # Проверка прокси в blacklist
│   ├── openAI.ts              # Интеграция с DeepSeek AI
│   └── ...                    # Другие утилиты
│
├── templates/                 # HTML шаблоны для email
│   ├── back.html              # Шаблон "Назад"
│   ├── go.html                # Шаблон "Вперед"
│   ├── push.html              # Шаблон "Толкай"
│   └── sms.html               # Шаблон "SMS"
│
├── types/                     # TypeScript типы
│   └── index.ts               # CustomContext, SessionData, CustomApi
│
└── views/                     # Представления (текстовые шаблоны)
    └── ...                    # Текстовые сообщения для бота
```

---

## 🔧 Основные компоненты

### **1. index.ts**
🚀 **Точка входа приложения**

#### Что делает:
- Инициализирует Grammy бота
- Запускает API сервер на порту 3000
- Запускает EmailStreamManager (IMAP мониторинг)
- Обрабатывает глобальные ошибки
- Graceful shutdown (SIGINT, SIGTERM)

#### Основные функции:
- `startApiServer(3000)` - Запуск REST API
- `EmailStreamManager.startAllForEveryone()` - Запуск IMAP для всех пользователей
- `stopRunner()` - Остановка бота и очистка ресурсов

#### Используемые библиотеки:
- `@grammyjs/runner` - Запуск бота
- `grammy` - Telegram Bot API framework

---

### **2. bot.ts**
🤖 **Инициализация Grammy бота**

#### Что делает:
- Создает экземпляр бота с токеном из config
- Подключает middlewares (session, rate-limiter, hydrate)
- Подключает conversations для диалогов
- Настраивает auto-retry для Telegram API
- Sequentialize для предотвращения race conditions

#### Middlewares:
- `session()` - Сохранение состояния диалогов
- `limit()` - Rate-limiting запросов
- `autoRetry()` - Автоматические повторы при ошибках Telegram API (до 3 раз, 30 сек)
- `sequentialize()` - Последовательная обработка сообщений от одного пользователя
- `userMiddleware` - Проверка пользователя в БД
- `conversations()` - Поддержка диалогов

#### Используемые библиотеки:
- `grammy` - Core framework
- `@grammyjs/runner` - Long polling runner
- `@grammyjs/auto-retry` - Автоматические повторы
- `@grammyjs/conversations` - Диалоги
- `@grammyjs/hydrate` - Hydration для API
- `@grammyjs/ratelimiter` - Rate limiting

---

### **3. config.ts**
⚙️ **Загрузка конфигурации**

#### Что делает:
- Читает `config.ini` из корня проекта
- Парсит INI формат (key=value)
- Экспортирует переменные окружения

#### Основные переменные:
```typescript
BOT_TOKEN: string              // Telegram Bot Token
DATABASE_URL: string           // Путь к SQLite базе
FAKE_LINK_DOMAIN: string       // Домен для коротких ссылок
WEBHOOK_URL: string            // URL для webhook в auto_answer
API_ID: number                 // Telegram API ID
API_HASH: string               // Telegram API Hash
```

#### Функции:
- `loadConfigIni()` - Загрузка config.ini
- `required()` - Обязательная переменная
- `optional()` - Опциональная переменная с default значением

---

### **4. emailSender.ts**
📤 **Логика отправки email (рассылка)**

#### Что делает:
- Управляет очередью рассылки для каждого пользователя
- Выбирает email, прокси, пресет из БД
- Отправляет письма через `nodemailer` с SOCKS5 прокси
- Проверяет прокси на blacklist перед рассылкой
- Обновляет статус объявлений в БД
- Отправляет уведомления в Telegram о статусе рассылки

#### Основные функции:
- `startSendFromDb(telegramId, limit)` - Запуск рассылки для пользователя
- `stopSendForUser(telegramId)` - Остановка рассылки
- `sendStatusForUser(telegramId)` - Получение статуса рассылки
- `isUserSending(telegramId)` - Проверка активной рассылки
- `checkAndCleanProxies(telegramId)` - Проверка прокси на blacklist

#### Логика рассылки:
1. Получить объявления со статусом 2 (ready)
2. Получить email, прокси, пресет из БД (cursor-based)
3. Проверить прокси на blacklist
4. Отправить письмо через SOCKS5 прокси
5. Обновить статус объявления (3 = sent, 4 = error)
6. Применить интервал между отправками
7. Повторить до лимита или завершения

#### Используемые библиотеки:
- `nodemailer` - Отправка email
- SQLite queries через Drizzle ORM

---

### **5. emailQueue.ts**
🔍 **Подбор email по именам через Kleinanzeigen API**

#### Что делает:
- Получает файл с объявлениями (имена продавцов)
- Подбирает email по имени через Kleinanzeigen API (rounds)
- Сохраняет найденные email в БД (таблица `adverts`)
- Отправляет webhook в auto_answer о завершении подбора
- Управляет API ключами (rotation, disable при лимитах)

#### Основные функции:
- `processFileFromBot(ctx, file)` - Обработка файла от бота
- `fetchEmails(keys, emails, profiles, rounds)` - Подбор email
- `sendSelectionCompletedWebhook(userId, foundCount)` - Webhook о завершении

#### Логика подбора:
1. Получить файл JSON с именами
2. Разбить на батчи по 100 имен
3. Для каждого батча:
   - Выбрать API ключ (rotation)
   - Отправить запрос к Kleinanzeigen API
   - Сохранить результаты в БД
4. Отправить webhook в auto_answer
5. Уведомить пользователя в Telegram

#### Используемые библиотеки:
- `axios` - HTTP запросы к Kleinanzeigen API
- Drizzle ORM для БД

---

### **6. emailStream.ts**
📨 **IMAP мониторинг входящих писем**

#### Что делает:
- Подключается к IMAP для каждого email пользователя
- Слушает новые письма в реальном времени
- Парсит письма (тема, тело, отправитель)
- Сохраняет в БД (таблица `email_messages`)
- Отправляет webhook в auto_answer о новом письме
- Отправляет уведомление в Telegram с кнопками (ответить, ссылка)

#### Основные функции:
- `EmailStreamManager.startAllForEveryone()` - Запуск IMAP для всех пользователей
- `EmailStreamManager.stopAllForEveryone()` - Остановка всех IMAP
- `startForUser(userId)` - Запуск IMAP для одного пользователя
- `stopForUser(userId)` - Остановка IMAP для пользователя

#### Логика мониторинга:
1. Получить все email пользователя из БД
2. Для каждого email:
   - Подключиться к IMAP (ImapFlow)
   - Слушать событие `exists` (новое письмо)
3. При новом письме:
   - Скачать и распарсить (mailparser)
   - Сохранить в БД
   - Отправить webhook в auto_answer
   - Отправить уведомление в Telegram

#### Reconnect логика:
- Exponential backoff при ошибках
- Автоматический reconnect при обрыве
- Защита от спама (scanning lock)

#### Используемые библиотеки:
- `imapflow` - IMAP клиент
- `mailparser` - Парсинг email

---

### **7. api/server.ts**
🌐 **REST API сервер для внешнего управления**

#### Что делает:
- Принимает HTTP запросы от Python скриптов (auto_answer)
- Управляет рассылкой (старт/стоп)
- Генерирует ссылки на объявления
- Отправляет ответы на email (preset, HTML)
- Проверяет статус бота

#### API Endpoints:

**POST /api/start_send**
```json
{
  "user_id": 123456789,
  "limit": 10
}
```
Запустить рассылку для пользователя.

**POST /api/stop_send**
```json
{
  "user_id": 123456789
}
```
Остановить рассылку.

**POST /api/generate_link**
```json
{
  "email_id": 42
}
```
Сгенерировать короткую ссылку на объявление.

**POST /api/answer_message**
```json
{
  "email_id": 42,
  "preset_id": 1
}
```
Отправить preset ответ на email.

**POST /api/answer_message_html**
```json
{
  "email_id": 42,
  "html_type": "go"
}
```
Отправить HTML шаблон ответ.

**GET /api/status**
Получить статус бота.

**POST /api/detect_gender**
```json
{
  "first_name": "Anna",
  "last_name": "Schmidt"
}
```
Определить пол по имени через DeepSeek AI.

#### Используемые библиотеки:
- `Bun.serve()` - HTTP сервер
- `nodemailer` - Отправка email

---

### **8. db/schema.ts**
💾 **Схема базы данных (Drizzle ORM)**

#### Таблицы:

**users** - Пользователи бота
- `id`, `telegramId`, `username`, `role` (guest/user/admin)
- `team` (tsum/aqua/nur)
- Флаги режимов: `giroMode`, `topicMode`, `smartMode`, `spoofMode`, `htmlMailerMode`, `shortMode`, `paypalMode`, `lockMode`
- `interval` - интервал между отправками `[min, max]`
- API ключи: `apiKeyTsum`, `apiKeyAqua`, `apiKeyNur`
- Profile ID: `profileIdTsum`, `profileIdAqua`, `profileIdNur`
- Cursor ID: `emailCursorId`, `proxyCursorId`, `smartPresetCursorId`

**emails** - Email аккаунты для отправки
- `id`, `userId`, `email`, `appPassword`, `isValid`, `priority`

**proxies** - SOCKS5 прокси
- `id`, `userId`, `proxy`, `isValid`, `priority`

**presets** - Текстовые шаблоны писем
- `id`, `userId`, `name`, `text`

**smart_presets** - Умные пресеты (с переменными)
- `id`, `userId`, `name`, `text`

**adverts** - Объявления (результаты парсинга)
- `id`, `userId`, `advertId`, `advertName`, `email`, `emailStatus` (0=new, 1=parsing, 2=ready, 3=sent, 4=error)

**topics** - Топики для smart mode
- `id`, `userId`, `name`, `text`

**email_messages** - Входящие письма (от IMAP)
- `id`, `userId`, `emailAccountId`, `sender`, `recipient`, `subject`, `body`, `receivedAt`

**keys** - API ключи Kleinanzeigen
- `id`, `keyValue`, `rps`, `enabled`, `lastDisabledReason`

#### Используемые библиотеки:
- `drizzle-orm` - Type-safe ORM
- `better-sqlite3` - SQLite driver

---

### **9. commands/**
⌨️ **Telegram команды**

#### Основные команды:

**/start** - Приветствие и инструкция  
**/config** - Настройки пользователя (меню)  
**/send** - Запуск рассылки  
**/stop** - Остановка рассылки  
**/status** - Статус текущей рассылки  
**/test** - Тест одной отправки  
**/testall** - Тест всех email аккаунтов  
**/testhtml** - Тест HTML шаблонов  
**/admin** - Админ панель (только для админов)  

---

### **10. conversations/**
💬 **Диалоги с пользователем (Grammy Conversations)**

#### Основные диалоги:

- **emailAdd** - Добавление email (email:appPassword)
- **emailEdit** - Редактирование email
- **proxyAdd** - Добавление прокси (login:pass@ip:port или ip:port)
- **proxyEdit** - Редактирование прокси
- **presetAdd** - Добавление пресета
- **presetEdit** - Редактирование пресета
- **smartPresetAdd** - Добавление умного пресета (с переменными)
- **smartPresetEdit** - Редактирование умного пресета
- **topicAdd** - Добавление топика
- **topicEdit** - Редактирование топика
- **sendEmail** - Отправка email через диалог
- **intervalEdit** - Изменение интервала рассылки `[min, max]`
- **apiKeyEdit** - Изменение API ключей
- **profileIdEdit** - Изменение Profile ID
- **spoofNameEdit** - Изменение spoof имени
- **userManagement** - Управление пользователями (админ)

---

### **11. handlers/**
🔧 **Обработчики событий**

- **adminPanel** - Админ панель (управление пользователями, роли)
- **adminCallbacks** - Коллбэки админ панели
- **sendEmail** - Обработка отправки email
- **settings** - Меню настроек
- **htmlTemplates** - Выбор HTML шаблона
- **fastAdd** - Быстрое добавление (файлы с email/proxy)
- **nickCheck** - Проверка никнейма в Kleinanzeigen

---

### **12. callbacks/getMail.ts**
📧 **Генерация ссылок и работа с входящими письмами**

#### Основные функции:

- `generateLink(advertId)` - Генерация короткой ссылки на объявление
- Обработка callback_query от кнопок в уведомлениях о письмах

---

### **13. webhooks/manager.ts**
🔗 **Webhooks для интеграции с auto_answer**

#### Функции:

- `sendNewEmailWebhook(data)` - Отправка webhook о новом письме
```json
{
  "email_id": 42,
  "sender": "seller@example.com",
  "recipient": "buyer@example.com",
  "subject": "Re: Product",
  "body": "Email text...",
  "message_id": 123,
  "timestamp": "2025-12-16T10:30:00"
}
```

- `sendSelectionCompletedWebhook(userId, foundCount)` - Webhook о завершении подбора
```json
{
  "user_id": 123456789,
  "found_count": 42,
  "timestamp": "2025-12-16T10:30:00"
}
```

---

## 🔄 Как это работает

### Архитектура системы:

```
┌─────────────────────────────────────────────────────────────┐
│                 Telegram Bot (Grammy + Bun)                  │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Commands     │  │ Conversations│  │ Handlers     │      │
│  │ /start /send │  │ emailAdd     │  │ adminPanel   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Middlewares & Session                    │  │
│  │  userMiddleware → roleMiddleware → conversations      │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────┬────────────────┘
                 │                            │
                 ▼                            ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│   emailSender.ts            │  │  emailStream.ts (IMAP)      │
│   (Рассылка)                │  │  (Мониторинг входящих)      │
│                              │  │                              │
│  1. Получить объявления     │  │  1. Подключиться к IMAP     │
│  2. Выбрать email/proxy     │  │  2. Слушать новые письма    │
│  3. Отправить через SOCKS5  │  │  3. Парсить и сохранить в БД│
│  4. Обновить статус в БД    │  │  4. Отправить webhook       │
│  5. Применить интервал      │  │  5. Уведомить в Telegram    │
└────────────────┬────────────┘  └────────────┬────────────────┘
                 │                            │
                 ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│              SQLite Database (Drizzle ORM)                   │
│                                                               │
│  users  emails  proxies  presets  adverts  email_messages   │
│  smart_presets  topics  keys                                │
└─────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                 REST API Server (Bun.serve)                  │
│                     http://localhost:3000                    │
│                                                               │
│  POST /api/start_send          - Запуск рассылки            │
│  POST /api/stop_send           - Остановка рассылки         │
│  POST /api/generate_link       - Генерация ссылки           │
│  POST /api/answer_message      - Отправка пресета           │
│  POST /api/answer_message_html - Отправка HTML              │
│  POST /api/detect_gender       - Определение пола (AI)      │
│  GET  /api/status              - Статус бота                │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│           auto_answer (Python Flask Webhook Server)          │
│                                                               │
│  Принимает webhooks:                                         │
│  - Новые письма → AI анализ → Автоответ                     │
│  - Завершение подбора → Запуск рассылки                     │
└─────────────────────────────────────────────────────────────┘
```

### Поток рассылки:

```
1. Пользователь → /send в Telegram
2. emailSender.ts → Получить объявления из БД (status = 2)
3. emailSender.ts → Выбрать email, proxy, preset (cursor-based rotation)
4. emailSender.ts → Проверить proxy на blacklist
5. emailSender.ts → Отправить через nodemailer + SOCKS5
6. emailSender.ts → Обновить статус объявления (3 = sent, 4 = error)
7. emailSender.ts → Применить интервал [min, max]
8. emailSender.ts → Повторить до лимита или завершения
9. Telegram → Уведомление "✅ Рассылка завершена!"
```

### Поток входящих писем:

```
1. emailStream.ts → IMAP подключение для всех email
2. ImapFlow → Событие "exists" (новое письмо)
3. emailStream.ts → Скачать и распарсить письмо (mailparser)
4. emailStream.ts → Сохранить в БД (email_messages)
5. webhooks/manager.ts → POST webhook в auto_answer/webhook_server.py
6. Telegram → Уведомление с кнопками (Ответить, Ссылка)
```

### Поток подбора email:

```
1. Python parser → Парсит Kleinanzeigen → Файл JSON с именами
2. Python → POST файл в Telegram бота
3. emailQueue.ts → Получить файл, разбить на батчи
4. emailQueue.ts → Для каждого батча:
   - Выбрать API ключ (rotation)
   - POST к Kleinanzeigen API
   - Сохранить результаты в БД (adverts, status = 2)
5. webhooks/manager.ts → POST webhook "selection completed" в auto_answer
6. Telegram → Уведомление "✅ Подбор завершён! Найдено: 42"
```

---

## 📦 Используемые библиотеки

### TypeScript/Bun:
- **grammy** - Telegram Bot API framework
- **@grammyjs/runner** - Long polling runner
- **@grammyjs/conversations** - Диалоги с пользователем
- **@grammyjs/auto-retry** - Автоматические повторы API
- **@grammyjs/hydrate** - Hydration для API
- **@grammyjs/ratelimiter** - Rate limiting
- **drizzle-orm** - Type-safe ORM для SQLite
- **better-sqlite3** - SQLite driver
- **imapflow** - IMAP клиент
- **mailparser** - Парсинг email
- **nodemailer** - Отправка email
- **socks** - SOCKS5 proxy support
- **axios** - HTTP запросы к Kleinanzeigen API

### Внешние сервисы:
- **Kleinanzeigen API** - Подбор email по именам
- **DeepSeek AI** - Определение пола по имени
- **Python Flask (auto_answer)** - Webhook сервер для автоответов

---

## 🚀 Запуск

```bash
# Установка зависимостей
bun install

# Запуск бота
bun run src/index.ts

# Или через package.json
bun run dev
```

### Конфигурация (`config.ini`):

```ini
BOT_TOKEN=your_telegram_bot_token
DATABASE_URL=./data.db
FAKE_LINK_DOMAIN=https://your-domain.com
WEBHOOK_URL=http://localhost:5000/webhook
API_ID=123456
API_HASH=your_api_hash
```

---

## 🎯 Основные фичи

### ✅ Рассылка email:
- Отправка через SOCKS5 прокси
- Rotation email/proxy/preset (cursor-based)
- Проверка прокси на blacklist перед рассылкой
- Интервалы между отправками `[min, max]`
- Auto-retry при ошибках (до 3 попыток)
- Уведомления в Telegram о статусе

### ✅ IMAP мониторинг:
- Реальное время для всех email аккаунтов
- Парсинг писем (тема, тело, отправитель)
- Webhook в auto_answer для AI анализа
- Уведомления в Telegram с кнопками

### ✅ Подбор email:
- Через Kleinanzeigen API (rounds)
- Rotation API ключей
- Обработка rate-limits (429)
- Сохранение результатов в БД

### ✅ REST API:
- Внешнее управление рассылкой
- Генерация коротких ссылок
- Отправка ответов (preset, HTML)
- Определение пола через AI

### ✅ Администрирование:
- Управление пользователями
- Роли (guest/user/admin)
- Просмотр статистики
- Управление API ключами

---

## 🔒 Безопасность

- Rate-limiting запросов
- Проверка прокси на blacklist
- Auto-retry с exponential backoff
- Graceful shutdown
- Логирование ошибок
- Session management

---

## 📊 База данных

SQLite с Drizzle ORM:
- `data.db` - Основная база
- Migrations в `drizzle/`
- Type-safe queries через репозитории

---

**Версия документации:** 1.0  
**Дата обновления:** 16.12.2025  
**Runtime:** Bun v1.1+  
**Framework:** Grammy (Telegram Bot API)
