import { db } from "../index";
import { users, proxies } from "../schema";
import { eq, and, asc, gt } from "drizzle-orm";

export class ProxyRepo {
  /** 🔒 Получить user.id по telegramId */
  private static async _getUserId(telegramId: number): Promise<number> {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get();

    if (!row) throw new Error(`User with telegramId=${telegramId} not found`);
    return row.id;
  }

  /** ➕ Добавить один или несколько прокси */
  static async add(telegramId: number, proxyList: string[]) {
    const userId = await this._getUserId(telegramId);

    // убираем дубликаты внутри списка
    const uniqueList = [...new Set(proxyList.map((p) => p.trim()))];

    // достаем существующие прокси у юзера
    const existing = await db
      .select({ proxy: proxies.proxy })
      .from(proxies)
      .where(eq(proxies.userId, userId))
      .all();

    const existingSet = new Set(existing.map((e) => e.proxy));

    // оставляем только новые
    const toInsert = uniqueList.filter((p) => !existingSet.has(p));

    if (toInsert.length === 0) return 0;

    // вставляем пачкой
    await db
      .insert(proxies)
      .values(toInsert.map((p) => ({ userId, proxy: p, isValid: 1 })))
      .run();

    return toInsert.length;
  }

  static async update(
    telegramId: number,
    proxyId: number,
    newProxy: string,
    isValid: boolean
  ) {
    const userId = await this._getUserId(telegramId);

    await db
      .update(proxies)
      .set({ proxy: newProxy.trim(), isValid: isValid ? 1 : 0 })
      .where(and(eq(proxies.id, proxyId), eq(proxies.userId, userId)))
      .run();
  }

  /** ✏️ Обновить статус прокси */
  static async setValid(telegramId: number, proxyId: number, isValid: boolean) {
    const userId = await this._getUserId(telegramId);

    await db
      .update(proxies)
      .set({ isValid: isValid ? 1 : 0 })
      .where(and(eq(proxies.id, proxyId), eq(proxies.userId, userId)))
      .run();
  }

  /** ❌ Удалить прокси */
  static async remove(telegramId: number, proxyId: number) {
    const userId = await this._getUserId(telegramId);

    await db
      .delete(proxies)
      .where(and(eq(proxies.id, proxyId), eq(proxies.userId, userId)))
      .run();
  }

  /** 🧹 Очистить все прокси */
  static async clear(telegramId: number) {
    const userId = await this._getUserId(telegramId);

    await db.delete(proxies).where(eq(proxies.userId, userId)).run();
  }

  /** 📃 Получить список прокси */
  static async list(telegramId: number) {
    const userId = await this._getUserId(telegramId);

    return db
      .select({
        id: proxies.id,
        proxy: proxies.proxy,
        isValid: proxies.isValid,
      })
      .from(proxies)
      .where(eq(proxies.userId, userId))
      .all();
  }

  static async nextValidProxy(
    telegramId: number
  ): Promise<{ id: number; proxy: string } | null> {
    const userId = await this._getUserId(telegramId);

    // Получаем все валидные прокси
    const validProxies = await db
      .select({ id: proxies.id, proxy: proxies.proxy })
      .from(proxies)
      .where(and(eq(proxies.userId, userId), eq(proxies.isValid, 1)))
      .all();

    if (validProxies.length === 0) return null;

    // Выбираем случайный прокси
    const randomIndex = Math.floor(Math.random() * validProxies.length);
    return validProxies[randomIndex];
  }

  /** 🧹 Сброс курсора */
  static async resetCursor(telegramId: number) {
    const userId = await this._getUserId(telegramId);
    await db
      .update(users)
      .set({ proxyCursorId: null })
      .where(eq(users.id, userId))
      .run();
  }
}
