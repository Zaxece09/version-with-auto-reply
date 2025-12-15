"""
MAIN API - Упрощенный запуск только webhook сервера
Без Telethon, работает через REST API бота
"""

import subprocess
import sys
import signal
import os
from pathlib import Path

webhook_process = None


def cleanup():
    """Остановка webhook сервера при выходе"""
    global webhook_process
    
    if webhook_process:
        print('\n🛑 Остановка webhook сервера...')
        webhook_process.terminate()
        try:
            webhook_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            webhook_process.kill()
            webhook_process.wait()
        print('✅ Webhook сервер остановлен')


def signal_handler(sig, frame):
    """Обработчик сигнала остановки (Ctrl+C)"""
    print(f'\n🛑 Получен сигнал {sig}')
    cleanup()
    sys.exit(0)


def main():
    """Запуск webhook сервера"""
    global webhook_process
    
    print("=" * 60)
    print("🚀 AUTO_ANSWER - API MODE")
    print("=" * 60)
    print("📡 Webhook Server: прием уведомлений о письмах")
    print("🤖 AI Analysis: DeepSeek анализ писем")
    print("🔗 API Integration: управление ботом через REST API")
    print("=" * 60 + "\n")
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    webhook_file = Path(__file__).parent / "webhook_server.py"
    if not webhook_file.exists():
        print(f"❌ Ошибка: файл {webhook_file} не найден!")
        sys.exit(1)
    
    print("🚀 Запуск webhook сервера...")
    try:
        webhook_process = subprocess.Popen(
            [sys.executable, str(webhook_file)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        
        print(f"✅ Webhook сервер запущен (PID: {webhook_process.pid})")
        print("\n" + "=" * 60)
        print("✅ Сервер работает!")
        print("=" * 60)
        print(f"📍 Webhook endpoint: http://localhost:8000/webhook/new_email")
        print(f"📍 Health check: http://localhost:8000/health")
        print(f"📍 Statistics: http://localhost:8000/stats")
        print("=" * 60 + "\n")
        
        for line in webhook_process.stdout:
            print(line, end='')
            
        webhook_process.wait()
        
    except KeyboardInterrupt:
        print("\n🛑 Остановка по Ctrl+C...")
    except Exception as e:
        print(f"\n❌ Ошибка: {e}")
    finally:
        cleanup()


if __name__ == '__main__':
    main()
