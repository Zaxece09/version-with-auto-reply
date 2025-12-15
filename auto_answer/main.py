"""
MAIN - Запуск webhook сервера + парсера
"""

import sys
import os
import multiprocessing

def main():
    """Запуск webhook сервера + парсера в отдельных процессах"""
    print("=" * 60)
    print("🚀 AUTO_ANSWER СИСТЕМА")
    print("=" * 60)
    print("Выберите режим работы:")
    print("  1 - Только автоответы (без парсера)")
    print("  2 - Автоответы + Парсер (полная система)")
    print("=" * 60)
    
    while True:
        choice = input("Введите номер режима (1 или 2): ").strip()
        if choice in ['1', '2']:
            break
        print("❌ Неверный выбор. Введите 1 или 2.")
    
    print()
    print("=" * 60)
    if choice == '1':
        print("🚀 РЕЖИМ: Только автоответы")
    else:
        print("🚀 РЕЖИМ: Автоответы + Парсер")
    print("=" * 60)
    print("📡 Webhook Server: прием уведомлений от бота")
    print("🤖 AI Analysis: DeepSeek анализ писем")
    print("🔗 API Integration: управление ботом через REST API")
    if choice == '2':
        print("📂 Parser: автоматический парсинг файлов")
    print("=" * 60)
    print()
    
    try:
        from webhook_server import run_webhook_server
        
        webhook_process = multiprocessing.Process(target=run_webhook_server, name="WebhookServer")
        
        print("🚀 Запуск Webhook Server...")
        webhook_process.start()
        
        if choice == '2':
            from parser_process import run_parser_processor
            parser_process = multiprocessing.Process(target=run_parser_processor, name="ParserProcessor")
            print("🚀 Запуск Parser Processor...")
            parser_process.start()
        
        print()
        if choice == '1':
            print("✅ Webhook сервер запущен!")
        else:
            print("✅ Оба процесса запущены!")
        print("📊 Для остановки нажмите Ctrl+C")
        print()
        
        webhook_process.join()
        if choice == '2':
            parser_process.join()
        
    except ImportError as e:
        print(f"❌ Ошибка импорта: {e}")
        print("Убедитесь что установлены зависимости: pip install -r requirements.txt")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n🛑 Остановка по Ctrl+C...")
        if 'webhook_process' in locals():
            webhook_process.terminate()
        if choice == '2' and 'parser_process' in locals():
            parser_process.terminate()
        sys.exit(0)
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
