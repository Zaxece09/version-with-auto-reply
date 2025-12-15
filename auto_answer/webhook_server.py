"""
WEBHOOK SERVER для auto_answer - принимает уведомления о новых письмах от бота
Автоматически анализирует письма через AI и отправляет ответы через REST API
"""

from flask import Flask, request, jsonify
import logging
from datetime import datetime
import json
import asyncio
import httpx
import os
from typing import Optional

from email_ai_processor import DeepSeekAI
from bot_api_client import BotAPIClient
from config import (
    BOT_API_URL, 
    BOT_API_TIMEOUT, 
    AUTO_ANSWER_PRESET_ID, 
    AUTO_ANSWER_HTML_TYPE,
    LOGGING_CONFIG
)

if LOGGING_CONFIG.get('webhook_server', True):
    logging.basicConfig(
        level=logging.INFO,
        format='[WEBHOOK] %(asctime)s - %(levelname)s - %(message)s',
        datefmt='%H:%M:%S'
    )
    logger = logging.getLogger(__name__)
else:
    logger = logging.getLogger(__name__)
    logger.disabled = True

app = Flask(__name__)

ai_client = DeepSeekAI()
bot_api = BotAPIClient(base_url=BOT_API_URL, timeout=BOT_API_TIMEOUT)

new_emails_queue = []
processed_emails = [] 
selection_history = []  

processing_worker_running = False

PROCESSED_EMAILS_FILE = 'data/processed_emails.json'


def normalize_subject(subject):
    """Убирает все префиксы Re:, Aw:, Fwd: и т.д. из темы письма"""
    normalized = subject.strip()
    changed = True
    while changed:
        changed = False
        for prefix in ['Re:', 'RE:', 'Re :', 'RE :', 'Aw:', 'AW:', 'Aw :', 'AW :', 'Fwd:', 'FWD:', 'Fw:', 'FW:']:
            if normalized.startswith(prefix):
                normalized = normalized[len(prefix):].strip()
                changed = True
                break
    return normalized


def load_processed_emails():
    """Загрузить список обработанных писем из файла"""
    try:
        with open(PROCESSED_EMAILS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if not isinstance(data, list):
                logger.warning(f"⚠️ Старый формат processed_emails.json, сброс данных")
                return []
            return data
    except FileNotFoundError:
        return []
    except json.JSONDecodeError as e:
        logger.error(f"❌ Ошибка парсинга processed_emails.json: {e}")
        logger.warning(f"🔄 Файл будет пересоздан")
        return []
    except Exception as e:
        logger.error(f"❌ Ошибка загрузки processed_emails: {e}")
        return []


def save_processed_emails(processed_list):
    """Сохранить список обработанных писем в файл"""
    try:
        with open(PROCESSED_EMAILS_FILE, 'w', encoding='utf-8') as f:
            json.dump(processed_list, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"❌ Ошибка сохранения processed_emails: {e}")


def is_email_processed(from_email, subject):
    """
    Проверить, было ли письмо от этого отправителя с такой темой уже обработано
    
    Args:
        from_email: Email отправителя
        subject: Тема письма
        
    Returns:
        True если письмо уже обрабатывалось
    """
    processed_list = load_processed_emails()
    
    normalized_subject = normalize_subject(subject)
    
    for item in processed_list:
        if not isinstance(item, dict):
            continue
            
        if item.get('from_email') == from_email:
            saved_subject = item.get('subject', '')
            
            if saved_subject == normalized_subject:
                return True
    
    return False


def mark_email_as_processed(from_email, subject, email_id, tg_user_id):
    """
    Отметить письмо как обработанное
    
    Args:
        from_email: Email отправителя
        subject: Тема письма (будет нормализована)
        email_id: ID письма
        tg_user_id: Telegram ID пользователя
    """
    processed_list = load_processed_emails()
    
    normalized_subject = normalize_subject(subject)
    
    processed_list.append({
        'from_email': from_email,
        'subject': normalized_subject,
        'email_id': email_id,
        'tg_user_id': tg_user_id,
        'processed_at': datetime.now().isoformat()
    })
    
    if len(processed_list) > 1000:
        processed_list = processed_list[-1000:]
    
    save_processed_emails(processed_list)
    logger.info(f"💾 Письмо отмечено как обработанное: {from_email} - {normalized_subject}")


async def process_email_queue_worker():
    """Фоновый обработчик очереди писем"""
    global processing_worker_running
    processing_worker_running = True
    
    logger.info("🔄 Запущен фоновый обработчик очереди писем")
    
    while processing_worker_running:
        try:
            if len(new_emails_queue) > 0:
                email_info = new_emails_queue.pop(0)
                
                logger.info(f"🚀 Обработка письма ID: {email_info.get('email_id')}")
                
                processing_result = await process_email_with_ai_and_api(email_info)
                
                email_info['processing_result'] = processing_result
                email_info['processed_at'] = datetime.now().isoformat()
                processed_emails.append(email_info)
                
                logger.info("=" * 60)
                logger.info("📊 РЕЗУЛЬТАТ ОБРАБОТКИ:")
                logger.info(f"  AI решение: {processing_result.get('ai_decision')}")
                logger.info(f"  Действия: {', '.join(processing_result.get('actions_taken', []))}")
                logger.info(f"  Успех: {processing_result.get('success')}")
                logger.info("=" * 60)
            else:
                await asyncio.sleep(1) 
                
        except Exception as e:
            logger.error(f"❌ Ошибка в обработчике очереди: {e}", exc_info=True)
            await asyncio.sleep(5)


async def auto_start_send(tg_user_id: int) -> bool:
    """
    Автоматически запускает рассылку через API после завершения подбора
    
    Args:
        tg_user_id: Telegram ID пользователя
        
    Returns:
        True если рассылка запущена успешно
    """
    try:
        logger.info(f"🚀 Автозапуск рассылки для пользователя {tg_user_id}")
        
        result = await bot_api.start_send(tg_user_id)
        
        if result.get("success"):
            logger.info(f"✅ Рассылка успешно запущена: {result.get('data')}")
            return True
        else:
            logger.error(f"❌ Ошибка запуска рассылки: {result.get('error')}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Критическая ошибка автозапуска рассылки: {e}")
        return False



async def process_email_with_ai_and_api(email_data: dict) -> dict:
    """
    Обрабатывает письмо: AI анализ + автоматические действия через API
    
    Args:
        email_data: Данные письма из webhook
        
    Returns:
        Результат обработки
    """
    result = {
        'email_id': email_data.get('email_id'),
        'advert_id': email_data.get('advert_id'),
        'ai_decision': None,
        'actions_taken': [],
        'success': False,
        'errors': []
    }
    
    try:
        email_text = f"""От: {email_data.get('from_email')} ({email_data.get('from_name', '')})
Тема: {email_data.get('subject')}

{email_data.get('full_text', email_data.get('text_preview', ''))}"""
        
        logger.info("🤖 Запуск AI анализа письма...")
        ai_decision = await ai_client.analyze_email(email_text)
        result['ai_decision'] = ai_decision
        
        logger.info(f"🤖 AI решение: {ai_decision}")
        
        if ai_decision == "ИГНОР":
            logger.info("⏭️ AI: Автоответ или нерелевантное письмо - игнорируем")
            result['success'] = True
            result['actions_taken'].append('ignored_auto_reply')
            mark_email_as_processed(
                from_email=email_data.get('from_email'),
                subject=email_data.get('subject'),
                email_id=email_data.get('email_id'),
                tg_user_id=email_data.get('tg_user_id')
            )
            return result
        
        if ai_decision == "НЕТ":
            logger.info("❌ AI: Продавец не хочет продавать - пропускаем")
            result['success'] = True
            result['actions_taken'].append('rejected_by_ai')
            mark_email_as_processed(
                from_email=email_data.get('from_email'),
                subject=email_data.get('subject'),
                email_id=email_data.get('email_id'),
                tg_user_id=email_data.get('tg_user_id')
            )
            return result
        
        if ai_decision == "ДА":
            logger.info("✅ AI: Продавец хочет продавать! Запускаем обработку...")
            
            tg_user_id = email_data.get('tg_user_id')
            advert_id = email_data.get('advert_id')
            
            if not advert_id and email_data.get('email_id'):
                logger.info(f"⚠️ advert_id отсутствует, ищем по email_id={email_data.get('email_id')}")
                try:
                    async with httpx.AsyncClient(timeout=30) as client:
                        response = await client.get(
                            f"http://localhost:3000/api/get_advert_by_email",
                            params={"email_id": email_data.get('email_id')}
                        )
                        if response.status_code == 200:
                            result = response.json()
                            if result.get('success'):
                                advert_id = result['data']['advert_id']
                                logger.info(f"✅ Найден advert_id={advert_id} по email_id")
                            else:
                                logger.warning(f"❌ Не удалось найти advert_id: {result.get('error')}")
                        else:
                            logger.warning(f"❌ API вернул статус {response.status_code}")
                except Exception as e:
                    logger.error(f"❌ Ошибка при поиске advert_id: {e}")
            
            if not tg_user_id or not advert_id:
                error = f"Отсутствуют tg_user_id ({tg_user_id}) или advert_id ({advert_id})"
                logger.error(error)
                result['errors'].append(error)
                return result
            
            api_result = await bot_api.process_email_auto(
                tg_user_id=tg_user_id,
                ad_id=advert_id,
                preset_id=AUTO_ANSWER_PRESET_ID,
                html_type=AUTO_ANSWER_HTML_TYPE,
                from_name=email_data.get('from_name', '')
            )
            
            if api_result.get('link_generated'):
                result['actions_taken'].append('link_generated')
            if api_result.get('preset_sent'):
                preset_email = api_result.get('preset_email', 'unknown')
                result['actions_taken'].append(f'preset_{AUTO_ANSWER_PRESET_ID}_sent')
                logger.info(f"📧 Пресет отправлен с: {preset_email}")
            if api_result.get('html_sent'):
                html_email = api_result.get('html_email', 'unknown')
                result['actions_taken'].append(f'html_{AUTO_ANSWER_HTML_TYPE}_sent')
                logger.info(f"📧 HTML отправлен с: {html_email}")
            
            if api_result.get('errors'):
                result['errors'].extend(api_result['errors'])
            
            result['success'] = (
                api_result.get('link_generated') and 
                api_result.get('preset_sent') and 
                api_result.get('html_sent')
            )
            
            if result['success']:
                logger.info("✅ Письмо успешно обработано!")
                mark_email_as_processed(
                    from_email=email_data.get('from_email'),
                    subject=email_data.get('subject'),
                    email_id=email_data.get('email_id'),
                    tg_user_id=tg_user_id
                )
            else:
                logger.warning(f"⚠️ Письмо обработано с ошибками: {result['errors']}")
            
            return result
        
        logger.warning(f"⚠️ Неожиданное решение AI: {ai_decision}")
        result['errors'].append(f'Unknown AI decision: {ai_decision}')
        return result
        
    except Exception as e:
        error = f"Критическая ошибка обработки: {e}"
        logger.error(error, exc_info=True)
        result['errors'].append(error)
        return result


@app.route('/health', methods=['GET'])
def health_check():
    """Проверка доступности сервера"""
    return jsonify({
        'status': 'ok',
        'service': 'auto_answer_webhook',
        'timestamp': datetime.now().isoformat()
    }), 200


@app.route('/webhook/new_email', methods=['POST'])
def handle_new_email():
    """
    Обработчик webhook'а о новом письме
    
    Ожидаемые поля:
    - event: "new_email"
    - timestamp: ISO timestamp
    - email_id: ID письма в БД
    - tg_user_id: Telegram ID пользователя
    - tg_message_id: ID сообщения в Telegram
    - advert_id: ID объявления (или null)
    - from_email: Email отправителя
    - from_name: Имя отправителя
    - subject: Тема письма
    - text_preview: Превью текста (500 символов)
    - full_text: Полный текст письма (опционально)
    """
    try:
        data = request.get_json()
        
        if not data:
            logger.error("Пустой запрос")
            return jsonify({'error': 'No data provided'}), 400
        
        required_fields = ['event', 'email_id', 'tg_user_id', 'from_email', 'subject']
        missing_fields = [field for field in required_fields if field not in data]
        
        if missing_fields:
            logger.error(f"Отсутствуют обязательные поля: {missing_fields}")
            return jsonify({
                'error': 'Missing required fields',
                'missing': missing_fields
            }), 400
        
        logger.info(f"📧 Новое письмо!")
        logger.info(f"  Email ID: {data.get('email_id')}")
        logger.info(f"  User ID: {data.get('tg_user_id')}")
        logger.info(f"  From: {data.get('from_email')} ({data.get('from_name', 'N/A')})")
        logger.info(f"  Subject: {data.get('subject')}")
        logger.info(f"  Advert ID: {data.get('advert_id', 'N/A')}")
        logger.info(f"  TG Message ID: {data.get('tg_message_id', 'N/A')}")
        
        from_email = data.get('from_email')
        subject = data.get('subject')
        
        if is_email_processed(from_email, subject):
            logger.info(f"⏭️ Письмо от {from_email} с темой '{subject}' уже было обработано - пропускаем")
            return jsonify({
                'status': 'skipped',
                'message': 'Email already processed (duplicate reply)',
                'email_id': data.get('email_id')
            }), 200
        
        email_info = {
            'email_id': data.get('email_id'),
            'tg_user_id': data.get('tg_user_id'),
            'tg_message_id': data.get('tg_message_id'),
            'advert_id': data.get('advert_id'),
            'from_email': data.get('from_email'),
            'from_name': data.get('from_name', ''),
            'subject': data.get('subject'),
            'text_preview': data.get('text_preview', ''),
            'full_text': data.get('full_text', ''),
            'received_at': datetime.now().isoformat(),
            'timestamp': data.get('timestamp')
        }
        
        new_emails_queue.append(email_info)
        
        try:
            with open('logs/webhook_emails.log', 'a', encoding='utf-8') as f:
                f.write(json.dumps(email_info, ensure_ascii=False) + '\n')
        except Exception as e:
            logger.error(f"Ошибка записи в лог: {e}")
        
        logger.info(f"✅ Письмо добавлено в очередь (всего в очереди: {len(new_emails_queue)})")
        
        return jsonify({
            'status': 'accepted',
            'message': 'Email queued for processing',
            'email_id': data.get('email_id')
        }), 202  
        
    except Exception as e:
        logger.error(f"❌ Ошибка обработки new_email webhook: {e}", exc_info=True)
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500
        
    except Exception as e:
        logger.error(f"❌ Ошибка обработки webhook: {e}")
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500


@app.route('/webhook/selection_completed', methods=['POST'])
def handle_selection_completed():
    """
    Обработчик webhook'а о завершении подбора почт
    
    Ожидаемые поля:
    - event: "selection_completed"
    - timestamp: ISO timestamp
    - tg_user_id: Telegram ID пользователя
    - found_count: Количество найденных email
    - total_count: Общее количество объявлений
    - not_found_ids: Список ID объявлений без email
    - duration_ms: Длительность подбора в миллисекундах
    """
    try:
        data = request.get_json()
        
        if not data:
            logger.error("Пустой запрос selection_completed")
            return jsonify({'error': 'No data provided'}), 400
        
        required_fields = ['event', 'tg_user_id', 'found_count', 'total_count']
        missing_fields = [field for field in required_fields if field not in data]
        
        if missing_fields:
            logger.error(f"Отсутствуют обязательные поля: {missing_fields}")
            return jsonify({
                'error': 'Missing required fields',
                'missing': missing_fields
            }), 400
        
        logger.info(f"📊 Подбор завершён!")
        logger.info(f"  User ID: {data.get('tg_user_id')}")
        logger.info(f"  Найдено: {data.get('found_count')}/{data.get('total_count')}")
        logger.info(f"  Не найдено IDs: {data.get('not_found_ids', [])}")
        logger.info(f"  Длительность: {data.get('duration_ms', 0)/1000:.1f}s")
        
        selection_info = {
            'tg_user_id': data.get('tg_user_id'),
            'found_count': data.get('found_count'),
            'total_count': data.get('total_count'),
            'not_found_ids': data.get('not_found_ids', []),
            'duration_ms': data.get('duration_ms', 0),
            'timestamp': data.get('timestamp'),
            'received_at': datetime.now().isoformat()
        }
        
        selection_history.append(selection_info)
        
        try:
            with open('logs/webhook_selections.log', 'a', encoding='utf-8') as f:
                f.write(json.dumps(selection_info, ensure_ascii=False) + '\n')
        except Exception as e:
            logger.error(f"Ошибка записи в webhook_selections.log: {e}")
        
        if data.get('found_count', 0) > 0:
            logger.info(f"💡 Найдено {data.get('found_count')} объявлений - запускаю рассылку через API")
            
            try:
                try:
                    loop = asyncio.get_event_loop()
                except RuntimeError:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                
                send_result = loop.run_until_complete(auto_start_send(data.get('tg_user_id')))
                
                if send_result:
                    logger.info("✅ Рассылка успешно запущена после подбора")
                else:
                    logger.warning("⚠️ Не удалось запустить рассылку автоматически")
                    
            except Exception as e:
                logger.error(f"❌ Ошибка запуска рассылки: {e}", exc_info=True)
        else:
            logger.info("ℹ️ Объявления не найдены, рассылка не запускается")
        
        logger.info("ℹ️ Рассылка завершена. Ожидаем автоматической пересылки файла от parser_process...")
        
        return jsonify({'status': 'ok', 'message': 'Selection completed processed'}), 200
        
    except Exception as e:
        logger.error(f"❌ Ошибка обработки selection_completed webhook: {e}")
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500


@app.route('/queue/status', methods=['GET'])
def queue_status():
    """Проверка статуса очереди и истории обработанных писем"""
    return jsonify({
        'queue_size': len(new_emails_queue),
        'processed_count': len(processed_emails),
        'recent_emails': [
            {
                'email_id': email['email_id'],
                'from': email['from_email'],
                'subject': email['subject'],
                'received_at': email['received_at'],
                'ai_decision': email.get('processing_result', {}).get('ai_decision'),
                'success': email.get('processing_result', {}).get('success')
            }
            for email in processed_emails[-10:] 
        ]
    }), 200


@app.route('/stats', methods=['GET'])
def get_stats():
    """Статистика обработки писем и подборов"""
    total = len(processed_emails)
    
    email_stats = {
        'total_processed': 0,
        'ai_decisions': {'ДА': 0, 'НЕТ': 0, 'ИГНОР': 0},
        'successful': 0,
        'failed': 0,
        'success_rate': 0
    }
    
    if total > 0:
        ai_decisions = {'ДА': 0, 'НЕТ': 0, 'ИГНОР': 0}
        successful = 0
        
        for email in processed_emails:
            result = email.get('processing_result', {})
            decision = result.get('ai_decision')
            if decision in ai_decisions:
                ai_decisions[decision] += 1
            if result.get('success'):
                successful += 1
        
        email_stats = {
            'total_processed': total,
            'ai_decisions': ai_decisions,
            'successful': successful,
            'failed': total - successful,
            'success_rate': round((successful / total) * 100, 2) if total > 0 else 0
        }
    
    selection_stats = {
        'total_selections': len(selection_history),
        'total_found': sum(s.get('found_count', 0) for s in selection_history),
        'total_checked': sum(s.get('total_count', 0) for s in selection_history),
        'avg_success_rate': 0,
        'recent_selections': []
    }
    
    if selection_history:
        total_checked = selection_stats['total_checked']
        total_found = selection_stats['total_found']
        selection_stats['avg_success_rate'] = round(
            (total_found / total_checked * 100) if total_checked > 0 else 0, 2
        )
        selection_stats['recent_selections'] = [
            {
                'user_id': s.get('tg_user_id'),
                'found': s.get('found_count'),
                'total': s.get('total_count'),
                'duration_s': round(s.get('duration_ms', 0) / 1000, 1),
                'timestamp': s.get('timestamp')
            }
            for s in selection_history[-5:]
        ]
    
    return jsonify({
        'emails': email_stats,
        'selections': selection_stats
    }), 200


@app.route('/queue/clear', methods=['POST'])
def clear_queue():
    """Очистка очереди писем"""
    global new_emails_queue
    count = len(new_emails_queue)
    new_emails_queue = []
    logger.info(f"🗑️ Очередь очищена ({count} писем удалено)")
    return jsonify({
        'status': 'success',
        'cleared': count
    }), 200


def run_webhook_server(host='0.0.0.0', port=8000):
    """Запуск webhook сервера"""
    os.makedirs('data', exist_ok=True)
    
    processed_count = len(load_processed_emails())
    
    logger.info("=" * 60)
    logger.info("🚀 Запуск Webhook сервера для auto_answer")
    logger.info("=" * 60)
    logger.info(f"📍 Сервер будет доступен на http://{host}:{port}")
    logger.info(f"📍 Webhook endpoint: http://{host}:{port}/webhook/new_email")
    logger.info(f"📍 Health check: http://{host}:{port}/health")
    logger.info(f"📍 Queue status: http://{host}:{port}/queue/status")
    logger.info(f"📊 Загружено обработанных писем: {processed_count}")
    logger.info("=" * 60)
    
    import threading
    
    def worker_thread():
        """Поток для async обработчика очереди"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(process_email_queue_worker())
    
    worker = threading.Thread(target=worker_thread, daemon=True)
    worker.start()
    
    logger.info("🟢 Запущен фоновый обработчик очереди писем в отдельном потоке")
    
    app.run(host=host, port=port, debug=False)


if __name__ == '__main__':
    run_webhook_server()
