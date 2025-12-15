# ⚙️ Примеры конфигурации

## 1. Настройка логирования

### Включить только email процессор (отключить парсер)
```python
# config.py
LOGGING_CONFIG = {
    'email_processor': True,      # ✅ Логировать
    'parser_process': False,       # ❌ Не логировать
    'main': True,
    'telegram_userbot': True,
    'control_bot': True,
}
```

**Использование:** Когда нужно отслеживать только обработку входящих писем, без лишних логов парсера.

---

### Включить только парсер (отключить email)
```python
# config.py
LOGGING_CONFIG = {
    'email_processor': False,      # ❌ Не логировать
    'parser_process': True,        # ✅ Логировать
    'main': True,
    'telegram_userbot': False,
    'control_bot': False,
}
```

**Использование:** Для отладки только процесса парсинга и отправки файлов.

---

### Минимальное логирование (только ошибки)
```python
# config.py
LOGGING_CONFIG = {
    'email_processor': False,
    'parser_process': False,
    'main': True,               # Только критические события
    'telegram_userbot': False,
    'control_bot': False,
}
```

**Использование:** В production режиме для минимизации размера логов.

---

### Полное логирование (все модули)
```python
# config.py
LOGGING_CONFIG = {
    'email_processor': True,
    'parser_process': True,
    'main': True,
    'telegram_userbot': True,
    'control_bot': True,
}
```

**Использование:** При отладке или первом запуске системы.

---

## 2. Настройка retry логики

### Увеличить количество попыток отправки файла
```python
# parser_process.py (строка ~110)
async def forward_file_with_retry(file_message, to_bot, max_retries=20):  # Было 10
    """
    Увеличено до 20 попыток при нестабильном интернете
    """
```

---

### Уменьшить количество попыток для быстрого fail
```python
# parser_process.py (строка ~110)
async def forward_file_with_retry(file_message, to_bot, max_retries=5):  # Было 10
    """
    Уменьшено до 5 попыток для быстрого обнаружения проблем
    """
```

---

### Изменить количество попыток создания ссылки
```python
# email_processor.py (строка ~200)
max_link_attempts = 30  # Было 20
```

**Использование:** Если NUR сервис часто выдает ошибки 500.

---

## 3. Настройка порога ошибок email

### Более строгий порог (быстрое обнаружение проблем)
```python
# email_processor.py (строка ~35)
MAX_CONSECUTIVE_ERRORS = 5  # Было 10
```

**Использование:** Когда нужно быстро останавливать систему при проблемах с почтами.

---

### Более мягкий порог (больше терпимости)
```python
# email_processor.py (строка ~35)
MAX_CONSECUTIVE_ERRORS = 20  # Было 10
```

**Использование:** Если иногда бывают временные ошибки, которые проходят сами.

---

## 4. Настройка таймаутов

### Увеличить таймаут ожидания файла
```python
# parser_process.py в функции run_parsing_cycle()
timeout = 1200  # Было 600 (10 минут → 20 минут)
```

**Использование:** Когда парсер работает медленно или обрабатывает много данных.

---

### Изменить интервалы проверки

#### Чаще проверять файлы от парсера
```python
# parser_process.py в wait_and_forward_file()
await asyncio.sleep(2)  # Было 5 (проверять каждые 2 сек вместо 5)
```

---

#### Реже проверять состояние рассылки
```python
# parser_process.py в file_sender_task()
if is_mailing_in_progress():
    await asyncio.sleep(30)  # Было 10 (проверять каждые 30 сек)
```

---

## 5. Примеры комбинированных конфигураций

### Режим разработки (много логов, мало попыток)
```python
# config.py
LOGGING_CONFIG = {
    'email_processor': True,
    'parser_process': True,
    'main': True,
    'telegram_userbot': True,
    'control_bot': True,
}

# parser_process.py
max_retries = 3  # Быстрый fail для отладки

# email_processor.py
max_link_attempts = 5
MAX_CONSECUTIVE_ERRORS = 3
```

---

### Режим production (мало логов, много попыток)
```python
# config.py
LOGGING_CONFIG = {
    'email_processor': False,
    'parser_process': False,
    'main': True,
    'telegram_userbot': False,
    'control_bot': False,
}

# parser_process.py
max_retries = 20  # Максимальная устойчивость

# email_processor.py
max_link_attempts = 30
MAX_CONSECUTIVE_ERRORS = 15
```

---

### Режим мониторинга (только email, без парсера)
```python
# config.py
LOGGING_CONFIG = {
    'email_processor': True,
    'parser_process': False,
    'main': False,
    'telegram_userbot': False,
    'control_bot': False,
}
```

**Использование:** Когда нужно следить только за обработкой входящих писем.

---

## 6. Настройка задержек

### Ускорить обработку (меньше задержек)
```python
# email_processor.py в process_email_with_ai()
await asyncio.sleep(1)  # Вместо 2-3 секунд
```

**⚠️ Внимание:** Может привести к ошибкам если бот не успевает обработать запросы.

---

### Замедлить обработку (больше стабильности)
```python
# email_processor.py в process_email_with_ai()
await asyncio.sleep(5)  # Вместо 2-3 секунд
```

**Использование:** Если бот не успевает обрабатывать быстрые запросы.

---

## 7. Расширенные настройки

### Изменить интервал между циклами парсинга
```python
# parser_process.py в parser_main()
if file_message:
    await asyncio.sleep(30)  # Было 10 (ждать 30 сек между циклами)
else:
    await asyncio.sleep(120)  # Было 60 (ждать 2 мин при ошибке)
```

---

### Отключить catch-up режим email процессора
```python
# email_processor.py в email_processor_main()
# Закомментировать этот блок:
# try:
#     print("📬 Проверка непрочитанных сообщений...")
#     recent_messages = await client.get_messages(EMAIL_BOT, limit=10)
#     ...
```

**Использование:** Если не нужно обрабатывать старые непрочитанные письма при запуске.

---

## 8. Диагностика и отладка

### Включить максимальное логирование для диагностики
```python
# В начале parser_process.py и email_processor.py
logging.basicConfig(
    level=logging.DEBUG,  # Было INFO
    format='%(asctime)s [%(levelname)s] %(name)s - %(message)s',
    handlers=[
        logging.FileHandler('debug.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
```

---

### Добавить дополнительные проверки
```python
# parser_process.py в file_sender_task()
logger.info(f"📊 Состояние очереди: {len(file_queue)} файлов")
logger.info(f"📡 Sync state: {load_sync_state()}")
logger.info(f"🕐 Время: {datetime.now()}")
```

---

## 9. Безопасность и восстановление

### Автоматическое сохранение состояния
```python
# Добавить в критические моменты
import json
from datetime import datetime

def save_checkpoint():
    checkpoint = {
        'timestamp': datetime.now().isoformat(),
        'queue_size': len(file_queue),
        'consecutive_errors': consecutive_email_errors,
    }
    with open('checkpoint.json', 'w') as f:
        json.dump(checkpoint, f, indent=2)
```

---

### Восстановление после краша
```python
# В начале parser_main() и email_processor_main()
def load_checkpoint():
    if os.path.exists('checkpoint.json'):
        with open('checkpoint.json', 'r') as f:
            return json.load(f)
    return None
```

---

## 10. Оптимизация производительности

### Увеличить размер очереди (для массовой обработки)
```python
# parser_process.py
MAX_QUEUE_SIZE = 100  # Ограничение размера очереди

# В file_sender_task()
if len(file_queue) > MAX_QUEUE_SIZE:
    logger.warning(f"⚠️ Очередь переполнена: {len(file_queue)}")
    await asyncio.sleep(60)
```

---

### Параллельная обработка email (расширенный режим)
```python
# email_processor.py
MAX_CONCURRENT_EMAILS = 5  # Обрабатывать до 5 писем параллельно

email_tasks = []
if len(email_tasks) < MAX_CONCURRENT_EMAILS:
    email_tasks.append(asyncio.create_task(process_email_with_ai(message)))
```

---

## Рекомендуемые конфигурации

### Для начинающих
```python
LOGGING_CONFIG = {
    'email_processor': True,
    'parser_process': True,
    'main': True,
}

max_retries = 10
max_link_attempts = 20
MAX_CONSECUTIVE_ERRORS = 10
```

### Для опытных (production)
```python
LOGGING_CONFIG = {
    'email_processor': False,
    'parser_process': False,
    'main': True,
}

max_retries = 15
max_link_attempts = 25
MAX_CONSECUTIVE_ERRORS = 12
```

### Для тестирования
```python
LOGGING_CONFIG = {
    'email_processor': True,
    'parser_process': True,
    'main': True,
}

max_retries = 3
max_link_attempts = 5
MAX_CONSECUTIVE_ERRORS = 3
```

---

**Важно:** После изменения конфигурации перезапустите систему для применения изменений!
