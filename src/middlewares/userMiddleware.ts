import type { Context, NextFunction } from "grammy";
import { UserRepo } from "../db/queries";

export async function userMiddleware(ctx: Context, next: NextFunction) {
  if (!ctx.from) return next();

  const telegramId = ctx.from.id;
  const username = ctx.from.username;

  // создать если нет
  await UserRepo.upsert(telegramId, username);

  // обновить username (с проверкой на дубликаты)
  await UserRepo.updateUsername(telegramId, username);

  // обновить lastOnline
  await UserRepo.updateLastOnline(telegramId);

  // Проверяем роль пользователя для не-start команд
  if (ctx.message?.text && !ctx.message.text.startsWith('/start') && !ctx.message.text.startsWith('/admin')) {
    try {
      const userRole = await UserRepo.getRole(telegramId);
      
      if (userRole === "guest") {
        await ctx.reply(
          "🚫 <b>Доступ ограничен</b>\n\n" +
          "У вас нет доступа к боту. Обратитесь к администратору для получения доступа.\n\n" +
          `Ваш ID: <code>${telegramId}</code>`,
          { parse_mode: "HTML" }
        );
        return; // Не вызываем next(), прерываем обработку
      }
    } catch (error) {
      console.error("Role check error in middleware:", error);
    }
  }

  // идём дальше по цепочке
  await next();
}
