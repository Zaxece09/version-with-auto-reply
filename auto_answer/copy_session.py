"""
Скрипт для копирования одной Telegram сессии на все необходимые файлы.
Использует существующую сессию и создаёт копии для разных процессов.
"""

import shutil
import os
from pathlib import Path

def copy_session_files():
    """
    Копирует основную сессию на все необходимые файлы сессий
    """
    sessions_dir = Path('sessions')
    sessions_dir.mkdir(exist_ok=True)
    
    source_session = 'userbot_session.session'
    
    if not os.path.exists(source_session):
        print(f"❌ Ошибка: Файл {source_session} не найден!")
        print(f"   Создайте сначала основную сессию, запустив parser_process.py")
        return False
    
    target_sessions = [
        'sessions/email_session.session',     
        'sessions/parser_session.session',     
        'sessions/session.session',          
    ]
    
    print(f"📂 Копирование сессии из: {source_session}\n")
    
    copied = 0
    skipped = 0
    
    for target in target_sessions:
        try:
            if os.path.exists(target):
                response = input(f"⚠️  {target} уже существует. Перезаписать? (y/n): ")
                if response.lower() != 'y':
                    print(f"   ⏭️  Пропущено: {target}")
                    skipped += 1
                    continue
            
            shutil.copy2(source_session, target)
            print(f"✅ Скопировано: {target}")
            copied += 1
            
        except Exception as e:
            print(f"❌ Ошибка при копировании {target}: {e}")
    
    print(f"\n{'='*60}")
    print(f"📊 Результат:")
    print(f"   ✅ Скопировано: {copied}")
    print(f"   ⏭️  Пропущено: {skipped}")
    print(f"{'='*60}")
    
    if copied > 0:
        print(f"\n✨ Готово! Теперь все процессы будут использовать одну и ту же авторизацию.")
        return True
    else:
        print(f"\n⚠️  Файлы не были скопированы.")
        return False


if __name__ == "__main__":
    print("="*60)
    print("🔄 КОПИРОВАНИЕ TELEGRAM СЕССИИ")
    print("="*60)
    print()
    
    success = copy_session_files()
    
    if success:
        print("\n💡 Подсказка:")
        print("   Если вы изменили API_ID или API_HASH, удалите все .session файлы")
        print("   и создайте новую авторизацию.")
    
    input("\nНажмите Enter для выхода...")
