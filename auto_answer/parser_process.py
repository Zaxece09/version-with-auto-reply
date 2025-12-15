"""
PARSER PROCESSOR - API VERSION
Парсинг управляется через API команды
Логика: API → команда → парсер выполняет → обновляет статус
"""

import asyncio
import logging
import json
import os
import re
import aiofiles
from telethon import TelegramClient, events
from telethon.errors import FloodWaitError

from config import API_ID, API_HASH, LOGGING_CONFIG

if LOGGING_CONFIG.get('parser_process', True):
    import sys
    
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)
    
    formatter = logging.Formatter('[PARSER] %(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
    
    file_handler = logging.FileHandler('logs/parser.log', encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setLevel(logging.INFO)
    stream_handler.setFormatter(formatter)
    stream_handler.flush = lambda: sys.stdout.flush()
    logger.addHandler(stream_handler)
    
    logging.getLogger('telethon').setLevel(logging.ERROR)
else:
    logger = logging.getLogger(__name__)
    logger.disabled = True

SOURCE_BOT = '@vo1d3_parser_bot' 
TARGET_BOT = '@amnyam_testt_bot' 

client = None

PARSING_COMMAND_FILE = 'data/parsing_command.json'

PARSING_STATE_FILE = 'data/parsing_state.json'

FORWARDED_FILES_DB = 'data/forwarded_files.json'

FILE_RETRY_FLAG = 'data/file_retry_needed.json'

SYNC_STATE_FILE = 'data/sync_state.json'

files_queue = []

last_file_message = None

PARSER_USER_ID = 7787819135


async def safe_get_messages(bot, limit=10, min_id=0, max_retries=2):
    """Безопасное получение сообщений с обработкой FloodWait"""
    for attempt in range(max_retries):
        try:
            if min_id:
                return await client.get_messages(bot, limit=limit, min_id=min_id)
            return await client.get_messages(bot, limit=limit)
        except FloodWaitError as e:
            if attempt < max_retries - 1:
                logger.warning(f"FloodWait {e.seconds}с при get_messages, ждём...")
                await asyncio.sleep(e.seconds)
            else:
                raise
    return []


async def save_parsing_state(status, last_forwarded=None):
    """Сохранить состояние парсинга в JSON"""
    try:
        state = {
            'status': status,
            'queue_count': len(files_queue),
            'files': [get_filename(msg) for msg in files_queue],
            'last_forwarded': last_forwarded,
            'timestamp': asyncio.get_event_loop().time()
        }
        async with aiofiles.open(PARSING_STATE_FILE, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(state, ensure_ascii=False, indent=2))
        logger.info(f"📊 Статус обновлен: {status}, очередь: {len(files_queue)}")
    except Exception as e:
        logger.error(f"Ошибка сохранения статуса: {e}")


async def load_parsing_state():
    """Загрузить состояние парсинга из JSON"""
    try:
        if not os.path.exists(PARSING_STATE_FILE):
            return {'state': 'idle', 'queue_count': 0}
        
        async with aiofiles.open(PARSING_STATE_FILE, 'r', encoding='utf-8') as f:
            content = await f.read()
            return json.loads(content)
    except Exception as e:
        logger.error(f"Ошибка загрузки статуса: {e}")
        return {'state': 'idle', 'queue_count': 0}



def get_filename(message):
    """Извлечь имя файла из сообщения"""
    if not message or not message.document:
        return None
    for attr in message.document.attributes:
        if hasattr(attr, 'file_name'):
            return attr.file_name
    return None


async def load_parsing_command():
    """Загрузить команду от API"""
    if os.path.exists(PARSING_COMMAND_FILE):
        try:
            async with aiofiles.open(PARSING_COMMAND_FILE, 'r', encoding='utf-8') as f:
                content = await f.read()
                return json.loads(content)
        except Exception as e:
            logger.error(f"Ошибка загрузки команды: {e}")
            return None
    return None


async def clear_parsing_command():
    """Очистить команду после выполнения"""
    try:
        if os.path.exists(PARSING_COMMAND_FILE):
            os.remove(PARSING_COMMAND_FILE)
            logger.info("🗑️ Команда очищена")
    except Exception as e:
        logger.error(f"Ошибка очистки команды: {e}")


async def load_forwarded_files():
    """Загрузить список пересланных файлов из JSON"""
    if os.path.exists(FORWARDED_FILES_DB):
        try:
            async with aiofiles.open(FORWARDED_FILES_DB, 'r', encoding='utf-8') as f:
                content = await f.read()
                return json.loads(content)
        except Exception as e:
            logger.error(f"Ошибка загрузки истории: {e}")
            return {}
    return {}


async def save_forwarded_files(forwarded_dict):
    """Сохранить список пересланных файлов в JSON"""
    try:
        async with aiofiles.open(FORWARDED_FILES_DB, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(forwarded_dict, ensure_ascii=False, indent=2))
    except Exception as e:
        logger.error(f"Ошибка сохранения истории: {e}")


async def check_and_clear_retry_flag():
    """Проверяет флаг повторной отправки файла и очищает его"""
    try:
        if os.path.exists(FILE_RETRY_FLAG):
            async with aiofiles.open(FILE_RETRY_FLAG, 'r', encoding='utf-8') as f:
                content = await f.read()
                data = json.loads(content)
                
            if 'timestamp' in data:
                import time
                age = time.time() - data['timestamp']
                if age < 300:
                    os.remove(FILE_RETRY_FLAG)
                    return True
            
            os.remove(FILE_RETRY_FLAG)
    except Exception as e:
        logger.error(f"Ошибка проверки флага повтора: {e}")
    return False


async def load_sync_state():
    """Загрузить состояние синхронизации"""
    if os.path.exists(SYNC_STATE_FILE):
        try:
            async with aiofiles.open(SYNC_STATE_FILE, 'r', encoding='utf-8') as f:
                content = await f.read()
                return json.loads(content)
        except Exception as e:
            logger.error(f"Ошибка загрузки sync_state: {e}")
            return {}
    return {}


async def save_sync_state(state_dict):
    """Сохранить состояние синхронизации"""
    try:
        async with aiofiles.open(SYNC_STATE_FILE, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(state_dict, ensure_ascii=False, indent=2))
    except Exception as e:
        logger.error(f"Ошибка сохранения sync_state: {e}")


async def is_mailing_in_progress():
    """Проверить, идет ли рассылка"""
    state = await load_sync_state()
    return not state.get('mailing_completed', True)


async def send_message(bot_username, text):
    """Отправить текстовое сообщение боту"""
    try:
        bot = await client.get_entity(bot_username)
        await client.send_message(bot, text)
        logger.info(f"✅ Отправлено сообщение '{text}' в {bot_username}")
        await asyncio.sleep(1)
        return True
    except Exception as e:
        logger.error(f"❌ Ошибка отправки сообщения: {e}")
        return False


async def click_button_by_data(bot_username, callback_data, max_attempts=3):
    """Нажать кнопку по callback_data"""
    for attempt in range(max_attempts):
        try:
            bot = await client.get_entity(bot_username)
            messages = await client.get_messages(bot, limit=5)
            
            for message in messages:
                if not message.buttons:
                    continue
                
                for row in message.buttons:
                    for button in row:
                        if hasattr(button, 'data') and button.data:
                            button_data = button.data.decode('utf-8')
                            if button_data == callback_data:
                                await button.click()
                                logger.info(f"✅ Нажата кнопка '{callback_data}' в {bot_username}")
                                await asyncio.sleep(1)
                                return True
            
            logger.warning(f"Кнопка '{callback_data}' не найдена (попытка {attempt + 1}/{max_attempts})")
            await asyncio.sleep(2)
            
        except Exception as e:
            logger.error(f"Ошибка нажатия кнопки: {e}")
    
    logger.error(f"Не удалось найти кнопку '{callback_data}'")
    return False


async def forward_file_with_retry(file_message, to_bot, max_retries=10):
    """
    Пересылает файл с повторными попытками при ошибках таймаута
    Возвращает True при успехе, False при полном провале
    """
    global last_file_message
    
    last_file_message = file_message
    
    target = await client.get_entity(to_bot)
    
    for attempt in range(1, max_retries + 1):
        try:
            logger.info(f"📤 Попытка пересылки файла ({attempt}/{max_retries})...")
            
            await client.forward_messages(target, file_message)
            await asyncio.sleep(5)
            
            messages = await safe_get_messages(to_bot, limit=5)
            
            for msg in messages:
                if msg.text:
                    if "❌ Не удалось скачать файл с серверов Telegram" in msg.text and "таймаут" in msg.text:
                        logger.warning(f"⚠️ Получена ошибка таймаута (попытка {attempt}/{max_retries})")
                        await asyncio.sleep(3)
                        break
                    elif "✅ Подбор" in msg.text or "⏳ Идет подбор" in msg.text or "Подбор запущен" in msg.text:
                        logger.info(f"✅ Файл успешно принят ботом!")
                        return True
            else:
                await asyncio.sleep(3)
                messages = await client.get_messages(to_bot, limit=5)
                for msg in messages:
                    if msg.text and ("✅ Подбор" in msg.text or "⏳ Идет подбор" in msg.text):
                        logger.info(f"✅ Файл успешно принят ботом!")
                        return True
                
                logger.info(f"✅ Файл переслан, ответ бота не получен явно")
                return True
                
        except Exception as e:
            logger.error(f"❌ Ошибка при пересылке файла: {e}")
            await asyncio.sleep(3)
    
    logger.error(f"❌ Не удалось переслать файл после {max_retries} попыток")
    return False


async def auto_forward_parser_files():
    """
    Автоматически следит за новыми файлами от VoidParser.
    Если пришел файл И очередь пустая И бот ждет файл - сразу пересылает его.
    """
    global files_queue, last_file_message
    
    logger.info("🔄 Запущен автоматический мониторинг файлов от VoidParser")
    
    source = await client.get_entity(SOURCE_BOT)
    last_checked_id = 0
    
    try:
        init_msg = await client.get_messages(source, limit=1)
        last_checked_id = init_msg[0].id if init_msg else 0
    except:
        pass
    
    while True:
        try:
            await asyncio.sleep(5)  
            
            messages = await safe_get_messages(SOURCE_BOT, limit=10)
            
            for msg in messages:
                if msg.id <= last_checked_id:
                    continue
                
                last_checked_id = msg.id
                
                if msg.text and "✅ Бот успешно завершил свою работу" in msg.text:
                    logger.info("✅ VoidParser завершил работу, проверяем файл в очереди...")
                    await try_forward_queued_file()
                    break
            
        except Exception as e:
            logger.error(f"❌ Ошибка в auto_forward_parser_files: {e}", exc_info=True)
            await asyncio.sleep(10)


async def check_and_forward_if_completed():
    """
    Проверяет последние сообщения от VoidParser на наличие сообщения о завершении.
    Если находит - пересылает файл из очереди.
    """
    try:
        logger.info("🔍 Проверяю, не завершил ли уже VoidParser работу...")
        
        messages = await safe_get_messages(SOURCE_BOT, limit=10)
        
        for msg in messages:
            if msg.text and "✅ Бот успешно завершил свою работу" in msg.text:
                logger.info("✅ Найдено сообщение о завершении VoidParser!")
                await try_forward_queued_file()
                return
        
        logger.info("ℹ️ VoidParser еще не завершил работу")
        
    except Exception as e:
        logger.error(f"❌ Ошибка в check_and_forward_if_completed: {e}", exc_info=True)


async def try_forward_queued_file():
    """
    Пытается переслать файл из очереди, если условия подходящие.
    """
    global files_queue, last_file_message
    
    state = await load_parsing_state()
    current_state = state.get('status', 'idle') 
    queue_size = len(files_queue)
    
    logger.info(f"📊 Текущее состояние: {current_state}, очередь: {queue_size}")
    
    if queue_size > 0 and current_state in ['waiting_one_file', 'waiting_for_mailing', 'idle', 'error_queue_empty']:
        logger.info("🚀 В очереди есть файл, автоматически пересылаю в бота...")
        
        file_msg = files_queue[0]
        
        filename = None
        if file_msg.document:
            for attr in file_msg.document.attributes:
                if hasattr(attr, 'file_name'):
                    filename = attr.file_name
                    break
        
        success = await forward_file_with_retry(file_msg, TARGET_BOT)
        
        if success:
            last_file_message = file_msg
            files_queue.pop(0) 
            logger.info(f"✅ Файл автоматически переслан в бота (осталось в очереди: {len(files_queue)})")
            await save_parsing_state("file_auto_forwarded", filename or "unknown")
            
            logger.info("🔄 Запускаю следующий парсинг...")
            asyncio.create_task(start_next_parsing())
        else:
            logger.error("❌ Не удалось автоматически переслать файл")
    else:
        logger.info(f"⏸️ Файл не пересылаем (состояние: {current_state}, очередь: {queue_size})")


async def retry_last_file_on_timeout():
    """
    Следит за сообщениями от TARGET_BOT и автоматически пересылает последний файл при таймауте
    Также проверяет флаг повторной отправки от email_processor
    """
    global last_file_message
    
    logger.info("🔄 Запущен мониторинг таймаутов для автоматической повторной отправки")
    
    target = await client.get_entity(TARGET_BOT)
    last_checked_id = 0
    
    try:
        init_msg = await client.get_messages(target, limit=1)
        last_checked_id = init_msg[0].id if init_msg else 0
    except:
        pass
    
    while True:
        try:
            await asyncio.sleep(3) 
            
            if await check_and_clear_retry_flag():
                if last_file_message:
                    recent_msgs = await safe_get_messages(target, limit=5)
                    selection_in_progress = False
                    
                    for msg in recent_msgs:
                        if msg.text and ("⏳ Идет подбор" in msg.text or "⏳ У вас уже идёт подбор" in msg.text or "начинаю обработку" in msg.text):
                            selection_in_progress = True
                            logger.info("⚠️ Подбор уже идёт - НЕ пересылаем файл повторно")
                            print(f"[PARSER] ⚠️ Подбор уже запущен - отменяем повторную отправку файла")
                            break
                    
                    if not selection_in_progress:
                        logger.warning("🔄 ПОЛУЧЕН ЗАПРОС от email_processor! Пересылаю последний файл...")
                        try:
                            await client.forward_messages(TARGET_BOT, last_file_message)
                            logger.info("✅ Файл переслан повторно по запросу email_processor")
                            await asyncio.sleep(5)
                        except Exception as e:
                            logger.error(f"❌ Ошибка повторной пересылки: {e}")
                else:
                    logger.warning("⚠️ Запрос получен, но нет сохранённого файла для повтора")
            
            messages = await safe_get_messages(target, limit=10)
            
            for msg in messages:
                if msg.id > last_checked_id:
                    last_checked_id = msg.id
                    
                    if msg.text and "❌ Не удалось скачать файл с серверов Telegram" in msg.text and "таймаут" in msg.text:
                        if last_file_message:
                            recent_msgs = await safe_get_messages(target, limit=5)
                            selection_in_progress = False
                            
                            for check_msg in recent_msgs:
                                if check_msg.text and ("⏳ Идет подбор" in check_msg.text or "⏳ У вас уже идёт подбор" in check_msg.text or "начинаю обработку" in check_msg.text):
                                    selection_in_progress = True
                                    logger.info("⚠️ Таймаут обнаружен, но подбор уже идёт - НЕ пересылаем файл")
                                    print(f"[PARSER] ⚠️ Таймаут, но подбор запущен - отменяем повторную отправку")
                                    break
                            
                            if not selection_in_progress:
                                logger.warning("🔴 ОБНАРУЖЕН ТАЙМАУТ! Автоматически пересылаю последний файл...")
                                
                                try:
                                    await client.forward_messages(TARGET_BOT, last_file_message)
                                    logger.info("✅ Файл переслан повторно после таймаута")
                                    await asyncio.sleep(5)
                                except Exception as e:
                                    logger.error(f"❌ Ошибка повторной пересылки: {e}")
                        else:
                            logger.warning("⚠️ Таймаут обнаружен, но нет сохранённого файла для повтора")
                        
        except FloodWaitError as e:
            logger.warning(f"⏳ FloodWait {e.seconds}с в мониторинге таймаутов - ожидаем...")
            await asyncio.sleep(e.seconds + 1)
        except Exception as e:
            logger.error(f"Ошибка мониторинга таймаутов: {e}")
            await asyncio.sleep(5)


async def wait_and_forward_file(from_bot, to_bot, start_msg_id, timeout=600):
    """
    Ожидать файл и переслать его с обработкой ошибок
    Возвращает True если файл был переслан
    """
    logger.info(f"⏳ Ожидание файла от {from_bot}...")
    
    start_time = asyncio.get_event_loop().time()
    bot = await client.get_entity(from_bot)
    forwarded = await load_forwarded_files()
    
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        try:
            messages = await safe_get_messages(bot, limit=20, min_id=start_msg_id)
            
            for message in messages:
                if message.document:
                    filename = None
                    for attr in message.document.attributes:
                        if hasattr(attr, 'file_name'):
                            filename = attr.file_name
                            break
                    
                    if filename and filename not in forwarded:
                        logger.info(f"📎 Найден файл: {filename}")
                        
                        success = await forward_file_with_retry(message, to_bot)
                        
                        if success:
                            forwarded[filename] = {'forwarded': True}
                            await save_forwarded_files(forwarded)
                            logger.info(f"✅ Файл переслан: {filename}")
                            return True
                        else:
                            logger.error(f"❌ Не удалось переслать файл {filename}")
                            return False
            
            await asyncio.sleep(5) 
            
        except FloodWaitError as e:
            logger.warning(f"⏳ FloodWait {e.seconds}с при ожидании файла - ожидаем...")
            await asyncio.sleep(e.seconds + 1)
        except Exception as e:
            logger.error(f"Ошибка ожидания файла: {e}")
            await asyncio.sleep(5)
    
    logger.warning("⏰ Таймаут ожидания файла")
    return False


async def wait_for_target_completion(bot_username, timeout=60):
    """Ожидание сообщения '✅ Подбор завершён!'"""
    logger.info(f"⏳ Ожидание завершения подбора от {bot_username}...")
    
    start_time = asyncio.get_event_loop().time()
    bot = await client.get_entity(bot_username)
    
    initial_messages = await client.get_messages(bot, limit=1)
    last_checked_id = initial_messages[0].id if initial_messages else 0
    
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        try:
            messages = await client.get_messages(bot, limit=10)
            
            for message in messages:
                if message.id <= last_checked_id:
                    continue
                
                if message.text:
                    if any(phrase in message.text for phrase in [
                        "✅ Подбор завершён",
                        "Подбор завершён",
                        "✅ Подбор завершен",
                        "Подбор завершен"
                    ]):
                        match = re.search(r'Найдено[:\s]+(\d+)', message.text)
                        count = int(match.group(1)) if match else 0
                        logger.info(f"✅ Подбор завершён! Найдено: {count}")
                        return count
                
                if message.id > last_checked_id:
                    last_checked_id = message.id
            
            await asyncio.sleep(3)
            
        except Exception as e:
            logger.error(f"Ошибка ожидания завершения: {e}")
            await asyncio.sleep(3)
    
    logger.warning("⏰ Таймаут ожидания завершения подбора")
    return 0


async def check_no_ads_ready(bot_username, last_msg_id):
    """Проверяет, получен ли ответ 'У вас нет готовых объявлений!'"""
    try:
        bot = await client.get_entity(bot_username)
        messages = await client.get_messages(bot, limit=5)
        
        for message in messages:
            if message.id > last_msg_id and message.text:
                if "У вас нет готовых объявлений!" in message.text:
                    logger.warning("⚠️ У вас нет готовых объявлений!")
                    return True, message.id
                elif "✅ Рассылка начата!" in message.text or "рассылка началась" in message.text.lower():
                    logger.info("✅ Рассылка началась!")
                    return False, message.id
        
        return False, last_msg_id
        
    except Exception as e:
        logger.error(f"Ошибка проверки ответа: {e}")
        return False, last_msg_id


async def check_if_selection_in_progress(bot_username):
    """Проверяет, идёт ли сейчас подбор"""
    try:
        bot = await client.get_entity(bot_username)
        messages = await client.get_messages(bot, limit=10)
        
        for message in messages:
            if message.text and ("⏳ Идет подбор" in message.text or "Подбор запущен" in message.text):
                logger.info("⏳ Обнаружен активный подбор")
                return True
        
        return False
        
    except Exception as e:
        logger.error(f"Ошибка проверки подбора: {e}")
        return False


async def run_parsing_cycle():
    """
    Один полный цикл парсинга:
    1. Отправить команду поиска
    2. Нажать кнопку show preset
    3. Запустить парсер
    4. Дождаться файла и добавить в очередь
    """
    logger.info("="*60)
    logger.info("🔄 НАЧАЛО НОВОГО ЦИКЛА ПАРСИНГА")
    logger.info("="*60)
    
    logger.info("1️⃣ Отправка команды '🔎 Начать поиск'...")
    success = await send_message(SOURCE_BOT, "🔎 Начать поиск")
    if not success:
        logger.error("❌ Не удалось отправить сообщение. Завершение цикла.")
        return None
    
    await asyncio.sleep(3)
    
    logger.info("2️⃣ Нажатие кнопки 'show_prst|last_parser|last_parser'...")
    success = await click_button_by_data(SOURCE_BOT, "show_prst|last_parser|last_parser")
    if not success:
        logger.warning("⚠️ Не удалось нажать кнопку, пробуем продолжить...")
    
    await asyncio.sleep(3)
    
    logger.info("3️⃣ Запуск парсера 'run_parser_preset|last_parser|'...")
    bot = await client.get_entity(SOURCE_BOT)
    current_messages = await client.get_messages(bot, limit=1)
    last_msg_id = current_messages[0].id if current_messages else 0
    
    success = await click_button_by_data(SOURCE_BOT, "run_parser_preset|last_parser|")
    if not success:
        logger.error("❌ Не удалось запустить парсер. Завершение.")
        return None
    
    logger.info("✅ Парсер запущен!")
    await asyncio.sleep(5)
    
    logger.info("4️⃣ Ожидание файла от парсера...")
    start_time = asyncio.get_event_loop().time()
    timeout = 600
    
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        try:
            messages = await safe_get_messages(bot, limit=20, min_id=last_msg_id)
            
            for message in messages:
                if message.document:
                    filename = None
                    for attr in message.document.attributes:
                        if hasattr(attr, 'file_name'):
                            filename = attr.file_name
                            break
                    
                    if filename:
                        logger.info(f"📎 Файл получен: {filename}")
                        return message 
            
            await asyncio.sleep(5)
            
        except FloodWaitError as e:
            logger.warning(f"⏳ FloodWait {e.seconds}с при ожидании файла - ожидаем...")
            await asyncio.sleep(e.seconds + 1)
        except Exception as e:
            logger.error(f"Ошибка ожидания файла: {e}")
            await asyncio.sleep(5)
    
    logger.warning("⏰ Таймаут ожидания файла")
    return None


async def start_next_parsing():
    """
    Запускает следующий цикл парсинга и добавляет файл в очередь.
    Вызывается автоматически после пересылки файла из очереди.
    """
    global files_queue, last_file_message
    
    try:
        logger.info("="*60)
        logger.info("🔄 АВТОЗАПУСК СЛЕДУЮЩЕГО ПАРСИНГА")
        logger.info("="*60)
        
        await save_parsing_state("parsing_next")
        
        file = await run_parsing_cycle()
        
        if not file:
            logger.warning("⚠️ Парсинг не вернул файл!")
            await save_parsing_state("error_no_file")
            return
        
        filename = get_filename(file)
        logger.info(f"✅ Файл получен: {filename}")
        
        files_queue.append(file)
        last_file_message = file
        
        logger.info(f"📦 Файл {filename} добавлен в очередь. Ожидание завершения рассылки...")
        await save_parsing_state("waiting_for_mailing", filename)
        
        await check_and_forward_if_completed()
        
        logger.info("="*60)
        logger.info("✅ СЛЕДУЮЩИЙ ПАРСИНГ ЗАВЕРШЕН: файл в очереди")
        logger.info("="*60)
        
    except Exception as e:
        logger.error(f"❌ ОШИБКА в start_next_parsing: {e}", exc_info=True)
        await save_parsing_state("error")


async def file_sender_task():
    """
    DEPRECATED: Больше не используется
    Отправка файлов теперь управляется через handle_send_next_file()
    """
    logger.warning("⚠️ file_sender_task() deprecated, используйте API")
    pass


async def handle_start_parsing():
    """
    Обработка команды start_parsing от API
    Логика: Запустить 2 парсинга подряд
    1. Первый парсинг → файл → переслать в бота
    2. СРАЗУ второй парсинг → файл → в очередь (ждать команду send_next)
    """
    global files_queue, last_file_message
    
    logger.info("="*60)
    logger.info("🚀 КОМАНДА: START_PARSING")
    logger.info("="*60)
    
    try:
        logger.info("1️⃣ Запуск первого парсинга...")
        await save_parsing_state("parsing_first")
        
        file1 = await run_parsing_cycle()
        
        if not file1:
            logger.error("❌ Первый парсинг не вернул файл!")
            await save_parsing_state("error_no_file")
            return
        
        filename1 = get_filename(file1)
        logger.info(f"✅ Первый файл получен: {filename1}")
        
        logger.info("📤 Пересылка первого файла в бота...")
        success = await forward_file_with_retry(file1, TARGET_BOT)
        
        if success:
            logger.info(f"✅ Файл {filename1} переслан в бота!")
            await save_parsing_state("first_file_forwarded", filename1)
            
            forwarded = await load_forwarded_files()
            forwarded[filename1] = {'forwarded': True}
            await save_forwarded_files(forwarded)
        else:
            logger.error(f"❌ Не удалось переслать первый файл {filename1}")
            await save_parsing_state("error_forward_failed")
            return
        
        logger.info("2️⃣ Запуск второго парсинга (параллельно с рассылкой)...")
        await save_parsing_state("parsing_second")
        
        file2 = await run_parsing_cycle()
        
        if not file2:
            logger.warning("⚠️ Второй парсинг не вернул файл!")
            await save_parsing_state("waiting_one_file")
            return
        
        filename2 = get_filename(file2)
        logger.info(f"✅ Второй файл получен: {filename2}")
        
        files_queue.append(file2)
        last_file_message = file2
        
        logger.info(f"📦 Файл {filename2} добавлен в очередь. Ожидание команды send_next_file...")
        await save_parsing_state("waiting_for_mailing", filename1)
        
        await check_and_forward_if_completed()
        
        logger.info("="*60)
        logger.info("✅ START_PARSING ЗАВЕРШЕН: 1 файл переслан, 1 в очереди")
        logger.info("="*60)
        
    except Exception as e:
        logger.error(f"❌ ОШИБКА в handle_start_parsing: {e}", exc_info=True)
        await save_parsing_state("error")


async def handle_send_next_file():
    """
    Обработка команды send_next_file от API
    Логика: Переслать файл из очереди + запустить новый парсинг
    """
    global files_queue, last_file_message
    
    logger.info("="*60)
    logger.info("🚀 КОМАНДА: SEND_NEXT_FILE")
    logger.info("="*60)
    
    try:
        if len(files_queue) == 0:
            logger.warning("⚠️ Очередь пуста! Нечего отправлять.")
            await save_parsing_state("error_queue_empty")
            return
        
        file_to_send = files_queue.pop(0)
        filename = get_filename(file_to_send)
        
        logger.info(f"📤 Отправка файла из очереди: {filename}")
        await save_parsing_state("sending_next_file")
        
        success = await forward_file_with_retry(file_to_send, TARGET_BOT)
        
        if success:
            logger.info(f"✅ Файл {filename} переслан в бота!")
            
            forwarded = await load_forwarded_files()
            forwarded[filename] = {'forwarded': True}
            await save_forwarded_files(forwarded)
            
            await save_parsing_state("file_forwarded", filename)
        else:
            logger.error(f"❌ Не удалось переслать файл {filename}")
            files_queue.insert(0, file_to_send)
            await save_parsing_state("error_forward_failed")
            return
        
        logger.info("3️⃣ Запуск нового парсинга для следующего файла...")
        await save_parsing_state("parsing_next")
        
        new_file = await run_parsing_cycle()
        
        if not new_file:
            logger.warning("⚠️ Новый парсинг не вернул файл!")
            await save_parsing_state("waiting_command")
            return
        
        new_filename = get_filename(new_file)
        logger.info(f"✅ Новый файл получен: {new_filename}")
        
        files_queue.append(new_file)
        last_file_message = new_file
        
        logger.info(f"📦 Файл {new_filename} добавлен в очередь. Ожидание команды send_next_file...")
        await save_parsing_state("waiting_for_mailing", filename)
        
        logger.info("="*60)
        logger.info("✅ SEND_NEXT_FILE ЗАВЕРШЕН: файл переслан, новый в очереди")
        logger.info("="*60)
        
    except Exception as e:
        logger.error(f"❌ ОШИБКА в handle_send_next_file: {e}", exc_info=True)
        await save_parsing_state("error")


async def file_sender_task():
    """
    Фоновая задача для отправки файлов из очереди
    Ждет завершения рассылки перед отправкой следующего файла
    """
    global file_queue
    
    logger.info("📤 Запущена задача отправки файлов")
    
    while True:
        try:
            if len(file_queue) > 0:
                file_message = file_queue[0]
                
                if await is_mailing_in_progress():
                    logger.info("⏳ Рассылка в процессе, ожидаем завершения...")
                    await asyncio.sleep(10)
                    continue
                
                logger.info("✅ Рассылка завершена, отправляем файл из очереди")
                
                filename = None
                for attr in file_message.document.attributes:
                    if hasattr(attr, 'file_name'):
                        filename = attr.file_name
                        break
                
                success = await forward_file_with_retry(file_message, TARGET_BOT)
                
                if success:
                    logger.info(f"✅ Файл {filename} успешно отправлен в TARGET_BOT")
                    file_queue.pop(0)
                    forwarded = await load_forwarded_files()
                    forwarded[filename] = {'forwarded': True}
                    await save_forwarded_files(forwarded)
                    await save_sync_state({'mailing_completed': False})
                else:
                    logger.error(f"❌ Не удалось отправить файл {filename}")
                    await asyncio.sleep(30)
            else:
                await asyncio.sleep(5)
                
        except Exception as e:
            logger.error(f"❌ Ошибка в задаче отправки файлов: {e}", exc_info=True)
            await asyncio.sleep(10)


async def command_listener():
    """
    Основной цикл: слушает команды от API
    Проверяет parsing_command.json каждые 3 секунды
    """
    logger.info("👂 Запущен слушатель команд API (проверка каждые 3 сек)")
    
    while True:
        try:
            await asyncio.sleep(3)
            
            command_data = await load_parsing_command()
            
            if command_data:
                command = command_data.get('command')
                user_id = command_data.get('user_id')
                
                if user_id != PARSER_USER_ID:
                    logger.warning(f"⚠️ Неверный user_id: {user_id}, ожидается {PARSER_USER_ID}")
                    await clear_parsing_command()
                    continue
                
                logger.info(f"📨 Получена команда: {command} (user_id={user_id})")
                
                if command == "start_parsing":
                    await clear_parsing_command()
                    await handle_start_parsing()
                    
                elif command == "send_next_file":
                    await clear_parsing_command()
                    await handle_send_next_file()
                    
                else:
                    logger.warning(f"⚠️ Неизвестная команда: {command}")
                    await clear_parsing_command()
            
        except Exception as e:
            logger.error(f"❌ Ошибка в command_listener: {e}", exc_info=True)
            await asyncio.sleep(10)


async def parser_main():
    """Главная функция парсера"""
    global client, files_queue
    
    logger.info("="*60)
    logger.info("🤖 PARSER PROCESSOR - Запуск (API MODE)")
    logger.info("="*60)
    logger.info(f"📡 SOURCE_BOT: {SOURCE_BOT}")
    logger.info(f"📡 TARGET_BOT: {TARGET_BOT}")
    logger.info(f"👤 PARSER_USER_ID: {PARSER_USER_ID}")
    logger.info("="*60)
    
    client = TelegramClient('sessions/parser_session', API_ID, API_HASH)
    client.flood_sleep_threshold = 0 
    
    await client.start()
    
    me = await client.get_me()
    logger.info(f"✅ Подключено как: {me.first_name} (@{me.username})")
    logger.info("🔄 Режим работы: API-управляемый парсинг")
    
    await save_parsing_state("idle")
    
    asyncio.create_task(retry_last_file_on_timeout())
    
    asyncio.create_task(auto_forward_parser_files())
    
    await command_listener()


async def parser_main():
    """Главная функция парсера"""
    global client, files_queue
    
    logger.info("="*60)
    logger.info("🤖 PARSER PROCESSOR - Запуск (API MODE)")
    logger.info("="*60)
    logger.info(f"📡 SOURCE_BOT: {SOURCE_BOT}")
    logger.info(f"📡 TARGET_BOT: {TARGET_BOT}")
    logger.info(f"👤 PARSER_USER_ID: {PARSER_USER_ID}")
    logger.info("="*60)
    
    client = TelegramClient('sessions/parser_session', API_ID, API_HASH)
    client.flood_sleep_threshold = 0 
    
    await client.start()
    
    me = await client.get_me()
    logger.info(f"✅ Подключено как: {me.first_name} (@{me.username})")
    logger.info("🔄 Режим работы: API-управляемый парсинг")
    
    await save_parsing_state("idle")
    
    asyncio.create_task(retry_last_file_on_timeout())
    
    logger.info("🚀 АВТОЗАПУСК: Запускаю первый парсинг...")
    asyncio.create_task(handle_start_parsing())
    
    await command_listener()


def run_parser_processor():
    """Запуск парсера (для multiprocessing)"""
    import sys
    import os
    print(f"[PARSER] 🤖 Parser Processor запускается (PID: {os.getpid()})...", flush=True)
    sys.stdout.flush()
    asyncio.run(parser_main())


if __name__ == "__main__":
    run_parser_processor()
