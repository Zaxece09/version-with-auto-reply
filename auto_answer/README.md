# AUTO_ANSWER - Система автоматической обработки email

Автоматизированная система для обработки входящих email сообщений с анализом через AI и автоматической отправкой ответов через REST API бота.

---

## 📁 Структура проекта

```
auto_answer/
├── main.py                    # Основная точка входа (режим с парсером)
├── main_api.py                # Упрощенный запуск (только автоответы, без Telethon)
├── config.py                  # Конфигурация (API ключи, настройки)
│
├── webhook_server.py          # Flask сервер для приема webhooks от бота
├── bot_api_client.py          # HTTP клиент для REST API бота
├── email_ai_processor.py      # AI анализ писем через DeepSeek
│
├── parser_process.py          # Автоматизация парсинга (Telethon)
├── copy_session.py            # Утилита копирования Telegram сессий
│
├── sessions/                  # Telegram сессии для Telethon
│   ├── email_session.session
│   ├── parser_session.session
│   └── session.session
│
├── data/                      # Данные и состояния (создается автоматически)
│   ├── processed_emails.json
│   ├── forwarded_files.json
│   ├── parsing_state.json
│   └── parsing_command.json
│
├── logs/                      # Логи работы системы
│   └── parser.log
│
└── docs/                      # Документация
    ├── CONFIGURATION_EXAMPLES.md
    ├── ERROR_MONITORING.md
    └── FLOW_DIAGRAM.md
```

---

## 🔧 Основные компоненты

### **1. webhook_server.py** 
📡 **Flask сервер для приема уведомлений от бота**

#### Что делает:
- Принимает POST запросы на `/webhook` от TypeScript бота
- Получает уведомления о новых email сообщениях
- Анализирует письма через DeepSeek AI
- Автоматически отправляет ответы через REST API

#### Основные функции:
- `webhook()` - Обработчик POST /webhook (прием уведомлений)
- `process_email_queue_worker()` - Фоновый обработчик очереди писем
- `process_email_with_ai_and_api()` - Анализ письма + отправка ответа
- `auto_start_send()` - Автоматический запуск рассылки после подбора

#### API endpoints:
```
POST /webhook              - Прием уведомлений о новых письмах
GET  /status               - Статус сервера и очередей
GET  /processed            - История обработанных писем
POST /clear_processed      - Очистка истории
```

#### Используемые библиотеки:
- `flask` - Web фреймворк для API
- `httpx` - Асинхронные HTTP запросы
- `asyncio` - Асинхронная обработка

---

### **2. bot_api_client.py**
🔗 **HTTP клиент для взаимодействия с REST API бота**

#### Что делает:
- Заменяет Telethon userbot на REST API запросы
- Управляет ботом через HTTP endpoints
- Отправляет команды боту (старт/стоп рассылки, ответы, генерация ссылок)

#### Основные методы:
- `start_send(limit)` - Запустить рассылку с лимитом
- `stop_send()` - Остановить рассылку
- `generate_link(email_id)` - Сгенерировать ссылку для объявления
- `answer_message_preset(email_id, preset_id)` - Отправить пресет
- `answer_message_html(email_id, html_type)` - Отправить HTML шаблон

#### REST API endpoints бота:
```
POST /api/start_send           - Запуск рассылки
POST /api/stop_send            - Остановка рассылки
POST /api/generate_link        - Генерация ссылки
POST /api/answer_message       - Отправка пресета
POST /api/answer_message_html  - Отправка HTML шаблона
GET  /api/status               - Статус бота
```

#### Используемые библиотеки:
- `httpx` - Асинхронный HTTP клиент
- `asyncio` - Асинхронное выполнение

---

### **3. email_ai_processor.py**
🤖 **AI анализ email сообщений через DeepSeek**

#### Что делает:
- Отправляет письма на анализ в DeepSeek API
- Определяет намерение отправителя (хочет ли продавать)
- Фильтрует системные сообщения и автоответы
- Определяет пол отправителя по имени

#### Основные классы:

**DeepSeekAI:**
- `analyze_email(text)` → `"ДА"` | `"НЕТ"` | `"ИГНОР"`
- `detect_gender(name)` → `"М"` | `"Ж"` | `"неизвестно"`

**EmailMessageParser:**
- `parse_email_message(text)` - Парсинг структуры письма
- `is_mail_delivery_system(sender)` - Фильтр системных сообщений
- `extract_name_from_email(email)` - Извлечение имени

**EmailStateManager:**
- `is_processed(msg_id)` - Проверка обработки
- `set_state(msg_id, state, data)` - Сохранение состояния

#### Используемые библиотеки:
- `httpx` - HTTP запросы к DeepSeek API
- `json` - Парсинг JSON ответов
- `re` - Регулярные выражения для парсинга

---

### **4. parser_process.py**
📂 **Автоматизация парсинга через Telethon (API-управление)**

#### Что делает:
- Управляется через JSON команды (`data/parsing_command.json`)
- Автоматически запускает парсер в `@vo1d3_parser_bot`
- Ожидает файлы с результатами
- Пересылает файлы в `@amnyam_testt_bot`
- Отслеживает статус подбора и рассылки

#### Основные функции:
- `run_parser_processor()` - Главный цикл обработки
- `execute_parsing_command()` - Выполнение команд
- `run_parsing_cycle()` - Один цикл парсинга
- `wait_and_forward_file()` - Ожидание и пересылка файла
- `wait_for_target_completion()` - Ожидание подбора

#### Команды управления (JSON):
```json
{
  "command": "start" | "stop" | "status",
  "timestamp": "2025-12-16T10:30:00"
}
```

#### Используемые библиотеки:
- `telethon` - Telegram userbot (TelegramClient, events)
- `asyncio` - Асинхронная обработка
- `aiofiles` - Асинхронная работа с файлами

---

### **5. config.py**
⚙️ **Конфигурация системы**

#### Содержит:
```python
API_ID = 611335
API_HASH = "d524b414d21f4d37f08684c1df41ac9c"

DEEPSEEK_API_KEY = "sk-192678198b784a0fa424b35c6721ae48"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"

EMAIL_BOT = "@amnyam_testt_bot"
SOURCE_BOT = "@vo1d3_parser_bot"
TARGET_BOT = "@amnyam_testt_bot"

BOT_API_URL = "http://localhost:3000"
BOT_API_TIMEOUT = 240

AUTO_ANSWER_PRESET_ID = 1 #ID пресета для отправки с бд
AUTO_ANSWER_HTML_TYPE = "go" #HTML для отправки

LOGGING_CONFIG = {
    'parser_process': True,
    'main': True,
    'webhook_server': True,
}
```

---

### **6. main.py**
🚀 **Точка входа (полная система)**

#### Что делает:
- Запускает webhook сервер в отдельном процессе
- Опционально запускает парсер
- Обрабатывает остановку через Ctrl+C

#### Режимы работы:
1. **Только автоответы** - без парсера
2. **Автоответы + Парсер** - полная система

#### Используемые библиотеки:
- `multiprocessing` - Запуск процессов

---

### **7. main_api.py**
🚀 **Упрощенный запуск (без Telethon)**

#### Что делает:
- Запускает только webhook сервер
- Не требует Telegram сессий
- Работает чисто через REST API

#### Используемые библиотеки:
- `subprocess` - Запуск процессов
- `signal` - Обработка остановки

---

### **8. copy_session.py**
📋 **Утилита копирования Telegram сессий**

#### Что делает:
- Копирует `userbot_session.session` на все необходимые файлы
- Создает сессии для разных процессов

#### Копируемые файлы:
- `sessions/email_session.session`
- `sessions/parser_session.session`
- `sessions/session.session`

#### Используемые библиотеки:
- `shutil` - Копирование файлов
- `os` - Работа с файловой системой

---

## 🔄 Как это работает

### Архитектура системы:

```
┌─────────────────────────────────────────────────────────────┐
│                    TypeScript Bot (Bun)                      │
│                   @amnyam_testt_bot                          │
│                                                               │
│  - Принимает email сообщения                                │
│  - Отправляет webhook в webhook_server.py                   │
│  - REST API endpoints для управления                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ POST /webhook
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              webhook_server.py (Flask)                      │
│                                                             │
│  1. Принимает webhook о новом письме                        │
│  2. Добавляет в очередь обработки                           │
│  3. Фоновый worker обрабатывает письма:                     │
│     ├─ Фильтрация дубликатов                                │
│     ├─ Парсинг структуры письма                             │
│     ├─ Фильтрация Mail Delivery System                      │
│     └─ Отправка на AI анализ                                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         email_ai_processor.py (DeepSeek AI)                 │
│                                                             │
│  Анализирует письмо:                                        │
│  ├─ "ИГНОР" → Автоответ/системное сообщение                 │
│  ├─ "НЕТ" → Не хочет продавать                              │
│  └─ "ДА" → Хочет продавать → Продолжить обработку           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼ (если "ДА")
┌─────────────────────────────────────────────────────────────┐
│           bot_api_client.py (HTTP Client)                   │
│                                                             │
│  Цепочка действий:                                          │
│  1. answer_message_preset() → Отправить пресет              │
│  2. generate_link() → Сгенерировать ссылку                  │
│  3. answer_message_html() → Отправить HTML шаблон           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ REST API requests
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    TypeScript Bot API                       │
│                                                             │
│  Выполняет команды:                                         │
│  ├─ Отправка email ответов                                  │
│  ├─ Генерация ссылок на объявления                          │
│  └─ Управление рассылками                                   │
└─────────────────────────────────────────────────────────────┘
```

## 📦 Используемые библиотеки

### Python (основные):
- **flask** - Web фреймворк для webhook сервера
- **httpx** - Асинхронный HTTP клиент для REST API
- **asyncio** - Асинхронное программирование
- **telethon** - Telegram userbot (для парсера)
- **aiofiles** - Асинхронная работа с файлами
- **logging** - Логирование
- **json** - Работа с JSON
- **re** - Регулярные выражения

### Внешние API:
- **DeepSeek API** - AI анализ текста писем
- **TypeScript Bot REST API** - Управление ботом

---

## 🚀 Запуск

### Вариант 1: Полная система (с парсером)
```bash
cd auto_answer
python main.py
```
Выберите режим:
- `1` - Только автоответы
- `2` - Автоответы + Парсер

### Вариант 2: Только автоответы (без Telethon)
```bash
cd auto_answer
python main_api.py
```

### Вариант 3: Только webhook сервер
```bash
cd auto_answer
python webhook_server.py
```

---

## 📡 REST API запросы

### Webhook Server (webhook_server.py)

#### POST /webhook
Прием уведомления о новом письме от бота:
```json
{
  "email_id": 123,
  "sender": "seller@example.com",
  "recipient": "buyer@example.com",
  "subject": "Re: Product inquiry",
  "body": "Yes, the item is still available...",
  "message_id": 456,
  "timestamp": "2025-12-16T10:30:00"
}
```

#### GET /status
Получить статус сервера:
```json
{
  "status": "running",
  "worker_active": true,
  "queue_size": 3,
  "processed_count": 42,
  "selection_history_count": 5
}
```

#### GET /processed
Получить историю обработанных писем:
```json
[
  {
    "email_id": 123,
    "message_id": 456,
    "subject": "Product inquiry",
    "ai_decision": "ДА",
    "timestamp": "2025-12-16T10:30:00"
  }
]
```

#### POST /clear_processed
Очистить историю обработанных писем.

---

### Bot REST API (через bot_api_client.py)

#### POST /api/start_send
Запустить рассылку:
```json
{
  "limit": 10
}
```

#### POST /api/stop_send
Остановить рассылку.

#### POST /api/generate_link
Сгенерировать ссылку для объявления:
```json
{
  "email_id": 123
}
```

#### POST /api/answer_message
Отправить пресет:
```json
{
  "email_id": 123,
  "preset_id": 1
}
```

#### POST /api/answer_message_html
Отправить HTML шаблон:
```json
{
  "email_id": 123,
  "html_type": "go"
}
```

#### GET /api/status
Получить статус бота.

---

## 🔧 Конфигурация

Отредактируйте `config.py`:

```python
API_ID = 611335
API_HASH = "your_api_hash"

DEEPSEEK_API_KEY = "sk-your-key"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"

BOT_API_URL = "http://localhost:3000"
BOT_API_TIMEOUT = 240

AUTO_ANSWER_PRESET_ID = 1
AUTO_ANSWER_HTML_TYPE = "go"
```

---

## 📝 Логирование

Логи сохраняются в:
- `logs/parser.log` - Парсер
- Консоль - Webhook сервер

Управление логированием в `config.py`:
```python
LOGGING_CONFIG = {
    'parser_process': True,
    'main': True,
    'webhook_server': True,
}
```

---

## 🗂️ Файлы данных

Создаются автоматически в `data/`:
- `processed_emails.json` - История обработанных писем
- `forwarded_files.json` - История пересланных файлов парсера
- `parsing_state.json` - Состояние парсера
- `parsing_command.json` - Команды для парсера

---

## ⚠️ Важные замечания

1. **webhook_server.py** работает только через REST API (без Telethon)
2. **parser_process.py** использует Telethon для парсинга (требует сессии)
3. Для работы парсера нужно скопировать сессии через `copy_session.py`
4. **main_api.py** - рекомендуемый способ запуска (без Telethon зависимостей)
5. DeepSeek API требует активный API ключ

---

## 🔄 Миграция с Telethon на REST API

**Завершено:**
- ✅ `email_processor.py` → Удален, заменен на `webhook_server.py`
- ✅ `control_bot.py` → Удален
- ✅ `telegram_userbot.py` → Удален (дублировал parser_process.py)

**Осталось:**
- ⚠️ `parser_process.py` → Использует Telethon для управления чужим парсер-ботом (оправдано)

---

## 📚 Дополнительная документация

- `docs/CONFIGURATION_EXAMPLES.md` - Примеры конфигурации
- `docs/ERROR_MONITORING.md` - Мониторинг ошибок
- `docs/FLOW_DIAGRAM.md` - Диаграммы потоков данных

---

## 🎯 Основной рабочий процесс

1. **TypeScript Bot** получает новое email сообщение
2. **Бот** отправляет POST запрос на `/webhook` в `webhook_server.py`
3. **Webhook Server** добавляет письмо в очередь
4. **Фоновый Worker** обрабатывает письма:
   - Фильтрует дубликаты
   - Парсит структуру
   - Отправляет в **DeepSeek AI**
5. **AI** анализирует письмо:
   - `"ИГНОР"` → Пропускает
   - `"НЕТ"` → Пропускает
   - `"ДА"` → Продолжает обработку
6. **bot_api_client.py** отправляет команды боту:
   - Отправка пресета
   - Генерация ссылки
   - Отправка HTML шаблона
7. **TypeScript Bot** выполняет команды и отправляет email

---

**Версия документации:** 1.0  
**Дата обновления:** 16.12.2025
