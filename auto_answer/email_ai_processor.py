"""
AI Processor для обработки email сообщений через DeepSeek
Анализирует, хотят ли продать товар
"""

import json
import re
import asyncio
from typing import Optional, Dict, Any
import httpx
from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
import logging

logger = logging.getLogger(__name__)


class DeepSeekAI:
    """Клиент для работы с DeepSeek API"""
    
    def __init__(self):
        self.api_key = DEEPSEEK_API_KEY
        self.base_url = DEEPSEEK_BASE_URL
        
    async def analyze_email(self, email_text: str) -> str:
        """
        Анализирует текст письма и определяет намерение отправителя
        
        Args:
            email_text: Текст письма для анализа
            
        Returns:
            "ДА" - хочет продать товар
            "НЕТ" - не хочет продавать (товар продан, занят и т.п.)
            "ИГНОР" - автоответ, системное сообщение, недоступность
        """
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "deepseek-chat",
                        "messages": [
                            {
                                "role": "system",
                                "content": """Ты эксперт по анализу email переписки на торговых площадках.
Твоя задача: определить намерение отправителя письма.

ВАЖНО: отвечай ТОЛЬКО одним словом - "ДА", "НЕТ" или "ИГНОР".

"ДА" - продавец ХОЧЕТ продать товар:
- "Да, еще есть"
- "Да, товар в наличии"
- "Конечно, можем встретиться"
- "Да, это доступно"

"НЕТ" - продавец НЕ ХОЧЕТ продавать (но это живой человек):
- "Извините, кто-то уже откликнулся раньше"
- "К сожалению, товар уже продан"
- "Нет, уже не актуально"
- "Извините, мы уже договорились с другим покупателем"

"ИГНОР" - это НЕ живой продавец (автоответы, системные сообщения, защита от мошенников, обвинения в мошенничестве):
- "Я больше не работаю здесь"
- "Письма на этот адрес не читаются"
- "Nicht mehr hier" (больше не здесь)
- "Automatic reply" (автоматический ответ)
- "Out of office" (отсутствую в офисе)
- "Dieser Kontakt ist nicht mehr aktiv"
- "This email address is no longer monitored"
- "Пожалуйста, отвечайте только через доску объявлений"
- "Bitte antworten Sie nur über die Anzeigentafel"
- "wenn Sie kein Betrüger sind" (если вы не мошенник)
- "if you are not a scammer" (если вы не мошенник)
- "scam", "betrug", "fraud", "fake" - обвинения в мошенничестве
- "это мошенничество", "das ist Betrug", "this is a scam"
- Любые сообщения с требованием отвечать только через платформу
- Любые автоматические уведомления об отсутствии/увольнении
- Любые обвинения в мошенничестве или предупреждения о скаме

Отвечай ТОЛЬКО "ДА", "НЕТ" или "ИГНОР", без пояснений!"""
                            },
                            {
                                "role": "user",
                                "content": f"Проанализируй это письмо:\n\n{email_text}"
                            }
                        ],
                        "temperature": 0.3,
                        "max_tokens": 10
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"❌ DeepSeek API error: {response.status_code} {response.text}")
                    return "ИГНОР"
                
                result = response.json()
                answer = result["choices"][0]["message"]["content"].strip().upper()
                
                logger.info(f"🤖 AI анализ: {answer}")
                
                if "ДА" in answer or "YES" in answer:
                    return "ДА"
                elif "ИГНОР" in answer or "IGNORE" in answer:
                    return "ИГНОР"
                else:
                    return "НЕТ"
                
        except Exception as e:
            logger.error(f"❌ Ошибка AI анализа: {e}")
            return "ИГНОР"


class EmailMessageParser:
    """Парсер сообщений от email бота"""
    
    @staticmethod
    def parse_email_message(message_text: str) -> Optional[Dict[str, str]]:
        """
        Парсит сообщение формата:
        ⚡ Получено сообщение на <recipient> от <sender>
        
        Тема:
        <subject>
        
        Текст:
        <body>
        
        Returns:
            dict с полями: recipient, sender, subject, body или None
        """
        try:
            text = re.sub(r'<[^>]+>', '', message_text)
            
            if not ("⚡" in text[:10]):
                return None
            
            
            text_clean = text.replace('**', '').replace('`', '')
            
            first_line_match = re.search(
                r'⚡\ufe0f?\s*Получено сообщение на\s+(.+?)\s+от\s+(.+?)(?=\n|$)',
                text_clean,
                re.DOTALL
            )
            
            if not first_line_match:
                logger.error(f"Не удалось извлечь получателя и отправителя из: {text[:100]}")
                return None
            
            recipient = first_line_match.group(1).strip()
            sender = first_line_match.group(2).strip()
            
            subject_match = re.search(r'Тема:\s*\n\s*(.+?)(?:\n\n|\n\s*Текст:)', text_clean, re.DOTALL)
            subject = subject_match.group(1).strip() if subject_match else ""
            
            body_match = re.search(r'Текст:\s*\n\s*(.+?)$', text_clean, re.DOTALL)
            body = body_match.group(1).strip() if body_match else ""
            
            return {
                "recipient": recipient,
                "sender": sender,
                "subject": subject,
                "body": body
            }
            
        except Exception as e:
            logger.error(f"❌ Ошибка парсинга сообщения: {e}", exc_info=True)
            return None
    
    @staticmethod
    def is_mail_delivery_system(sender: str) -> bool:
        """Проверяет, является ли отправитель системой доставки почты"""
        sender_lower = sender.lower()
        return (
            "mail delivery subsystem" in sender_lower or
            "mailer-daemon" in sender_lower or
            "postmaster" in sender_lower
        )
    
    @staticmethod
    def is_kleinanzeige_team(sender: str, body: str = "") -> bool:
        """Проверяет, является ли отправитель Kleinanzeige Team"""
        if "kleinanzeige team" in sender.lower():
            return True
        if body and "kleinanzeige team" in body.lower():
            return True
        return False
    
    @staticmethod
    def is_out_of_office_message(body: str) -> bool:
        """Проверяет, является ли сообщение автоответом об отсутствии"""
        body_lower = body.lower()
        out_of_office_phrases = [
            "больше не работает здесь",
            "не работает здесь",
            "nicht mehr hier",
            "no longer works here",
            "письма на этот старый адрес не читаются",
            "diesem alten adresse werden nicht gelesen",
            "this old address are not read",
            "автоматический ответ",
            "automatic reply",
            "automatische antwort",
            "out of office",
            "außer dienst"
        ]
        
        return any(phrase in body_lower for phrase in out_of_office_phrases)


class MailingStateManager:
    """Менеджер состояний процесса рассылки (независимо от email обработки)"""
    
    STATE_FILE = "data/mailing_state.json"
    
    WAITING_FILE = "WAITING_FILE"                    # Ожидание файла от парсера
    SELECTION_STARTED = "SELECTION_STARTED"          # Подбор начался
    SELECTION_IN_PROGRESS = "SELECTION_IN_PROGRESS"  # Подбор в процессе
    SELECTION_COMPLETED = "SELECTION_COMPLETED"      # Подбор завершился
    SENDING_COMMAND = "SENDING_COMMAND"              # Отправка /send
    MAILING_STARTED = "MAILING_STARTED"              # Рассылка началась
    MAILING_IN_PROGRESS = "MAILING_IN_PROGRESS"      # Рассылка в процессе
    MAILING_COMPLETED = "MAILING_COMPLETED"          # Рассылка завершена
    
    @staticmethod
    def get_state() -> str:
        """Получить текущее состояние рассылки"""
        try:
            with open(MailingStateManager.STATE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get("state", MailingStateManager.WAITING_FILE)
        except FileNotFoundError:
            MailingStateManager.set_state(MailingStateManager.WAITING_FILE)
            return MailingStateManager.WAITING_FILE
        except Exception as e:
            logger.error(f"Ошибка чтения состояния рассылки: {e}")
            return MailingStateManager.WAITING_FILE
    
    @staticmethod
    def set_state(new_state: str):
        """Установить новое состояние рассылки"""
        try:
            data = {
                "state": new_state,
                "timestamp": asyncio.get_event_loop().time()
            }
            with open(MailingStateManager.STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            logger.info(f"🔄 Состояние рассылки: {new_state}")
        except Exception as e:
            logger.error(f"Ошибка сохранения состояния рассылки: {e}")
    
    @staticmethod
    def can_process_emails() -> bool:
        """Проверяет, можно ли обрабатывать письма (не блокируется подбором)"""
        state = MailingStateManager.get_state()
        blocking_states = [
            MailingStateManager.SELECTION_STARTED,
            MailingStateManager.SELECTION_IN_PROGRESS
        ]
        return state not in blocking_states
    
    @staticmethod
    def should_send_after_queue() -> bool:
        """Проверяет, нужно ли отправить /send после обработки всех писем в очереди"""
        return MailingStateManager.get_state() == MailingStateManager.SELECTION_COMPLETED


class EmailStateManager:
    """Менеджер состояний обработки писем с отслеживанием прогресса шагов"""
    
    STATE_FILE = "data/processed_emails.json"
    
    REQUIRED_STEPS = [
        "link_created",      # Шаг 1: Создание ссылки
        "preset_sent",       # Шаг 4: Отправка пресета
        "html_sent"          # Шаг 8-9: Отправка HTML и подтверждение
    ]
    
    @staticmethod
    def load_states() -> Dict[str, Dict[str, Any]]:
        """Загрузить состояния из файла"""
        try:
            with open(EmailStateManager.STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            return {}
        except Exception as e:
            logger.error(f"❌ Ошибка загрузки состояний: {e}")
            return {}
    
    @staticmethod
    def save_states(states: Dict[str, Dict[str, Any]]):
        """Сохранить состояния в файл"""
        try:
            with open(EmailStateManager.STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump(states, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"❌ Ошибка сохранения состояний: {e}")
    
    @staticmethod
    def get_state(email_key: str) -> Optional[Dict[str, Any]]:
        """Получить состояние письма по ключу (отправитель:тема)"""
        states = EmailStateManager.load_states()
        return states.get(email_key)
    
    @staticmethod
    def set_state(email_key: str, state: str, data: Dict[str, Any] = None):
        """Установить состояние письма"""
        states = EmailStateManager.load_states()
        
        if email_key not in states:
            states[email_key] = {
                "steps": {}  # Прогресс выполнения шагов
            }
        
        states[email_key]["state"] = state
        states[email_key]["timestamp"] = asyncio.get_event_loop().time()
        
        if data:
            states[email_key].update(data)
        
        EmailStateManager.save_states(states)
        logger.info(f"📝 Состояние {email_key}: {state}")
    
    @staticmethod
    def set_step_completed(email_key: str, step_name: str):
        """Отметить шаг как выполненный"""
        states = EmailStateManager.load_states()
        
        if email_key not in states:
            states[email_key] = {"steps": {}}
        
        if "steps" not in states[email_key]:
            states[email_key]["steps"] = {}
        
        states[email_key]["steps"][step_name] = {
            "completed": True,
            "timestamp": asyncio.get_event_loop().time()
        }
        
        EmailStateManager.save_states(states)
        logger.info(f"✅ Шаг {step_name} выполнен для {email_key}")
    
    @staticmethod
    def is_step_completed(email_key: str, step_name: str) -> bool:
        """Проверить, выполнен ли шаг"""
        state = EmailStateManager.get_state(email_key)
        if not state or "steps" not in state:
            return False
        return state["steps"].get(step_name, {}).get("completed", False)
    
    @staticmethod
    def is_processed(email_key: str) -> bool:
        """Проверить, было ли письмо полностью обработано (все обязательные шаги выполнены)"""
        state = EmailStateManager.get_state(email_key)
        if not state:
            return False
        
        if state.get("state") == "COMPLETED":
            return True
        
        if "steps" not in state:
            return False
        
        steps = state["steps"]
        all_completed = all(
            steps.get(step, {}).get("completed", False) 
            for step in EmailStateManager.REQUIRED_STEPS
        )
        
        return all_completed
    
    @staticmethod
    def get_next_step(email_key: str) -> Optional[str]:
        """Получить следующий невыполненный шаг"""
        state = EmailStateManager.get_state(email_key)
        if not state or "steps" not in state:
            return EmailStateManager.REQUIRED_STEPS[0]
        
        steps = state["steps"]
        for step in EmailStateManager.REQUIRED_STEPS:
            if not steps.get(step, {}).get("completed", False):
                return step
        
        return None  # Все шаги выполнены
