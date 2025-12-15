import { Composer } from "grammy";
import { type Conversation, createConversation } from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import Menus from "../menus";
import { proxiesView } from "../views/settings";
import { ProxyRepo } from "../db/queries";
import { checkProxyHttp } from "../utils/checkProxyHttp";
import { checkProxyBlacklist } from "../utils/blacklistChecker";

const composer = new Composer<CustomContext>();


async function proxyAddConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext
) {
  // Кнопка отмены
  const cancelMenu = conversation
    .menu("cancel", { autoAnswer: false })
    .text("🚫 Отмена", async (ctx) => {
      await ctx.menu.close();
      await Menus.middleware()(ctx, () => Promise.resolve());
      await ctx.answerCallbackQuery("⚡️ Действие отменено");
      await proxiesView(ctx);
      await conversation.halt();
    });

  const waitingText =
    "✍️ Отправьте список прокси:\n\n" +
    "<i>Формат 1: <code>host:port:user:pass</code>\n" +
    "Формат 2: <code>user:pass@ip:port</code>\n" +
    "Каждый прокси — с новой строки.\n" +
    "Пример:\n" +
    "proxy.loma.host:38174:m1gtCAPtOj:atamnVzz8r\n" +
    "user:password@123.45.67.89:8080</i>";

  const requestMsg = await ctx.editMessageText(waitingText, {
    parse_mode: "HTML",
    reply_markup: cancelMenu,
  });

  // Ждём список
  const answer = await conversation.waitFor(":text");

  const proxiesRaw = answer.msg.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .map((l) => {
      // Если уже в формате user:pass@ip:port - оставляем как есть
      if (l.includes('@')) {
        // Изменяем первую цифру порта с 1 на 2
        const [credentials, hostPort] = l.split('@');
        const [ip, port] = hostPort.split(':');
        let modifiedPort = port;
        if (port.startsWith('1')) {
          modifiedPort = '2' + port.substring(1);
        }
        return `${credentials}@${ip}:${modifiedPort}`;
      }
      // Конвертируем host:port:user:pass -> user:pass@host:port
      const parts = l.split(':');
      if (parts.length === 4) {
        let port = parts[1];
        // Меняем первую цифру порта с 1 на 2
        if (port.startsWith('1')) {
          port = '2' + port.substring(1);
        }
        return `${parts[2]}:${parts[3]}@${parts[0]}:${port}`;
      }
      return l;
    })
    .filter((l) => /^.+:.+@.+:\d+$/.test(l)); // проверяем формат user:pass@ip:port

  await answer.deleteMessage();

  if (proxiesRaw.length === 0) {
    if (requestMsg !== true) {
      await requestMsg.editText(
        `${waitingText}\n\n❌ <b>Не найдено корректных строк.</b>`,
        { parse_mode: "HTML", reply_markup: cancelMenu }
      );
    }
    await conversation.halt();
    return;
  }

  // проверка валидности и blacklist параллельно
  if (requestMsg !== true) {
    await requestMsg.editText("⏳ Проверяем прокси и blacklist, подождите...", {
      parse_mode: "HTML",
      reply_markup: cancelMenu,
    });
  }

  const results = await Promise.all(
    proxiesRaw.map(async (p) => {
      try {
        // Извлекаем IP из прокси (user:pass@ip:port)
        const ipPort = p.split('@')[1];
        const ip = ipPort.split(':')[0];
        
        // Сначала проверяем блэклисты (быстрее чем HTTP)
        console.log(`[BLACKLIST] Checking IP: ${ip} in 50+ blacklists...`);
        const blacklistCheck = await checkProxyBlacklist(ip);
        if (blacklistCheck.listed) {
          const lists = blacklistCheck.blacklists.slice(0, 3).join(', ');
          console.log(`[BLACKLIST] ❌ Listed: ${ip} in ${lists} (${blacklistCheck.totalChecked} checked)`);
          return { 
            proxy: p, 
            valid: false, 
            reason: `Blacklisted in ${blacklistCheck.blacklists.length} lists` 
          };
        }
        console.log(`[BLACKLIST] ✅ Clean: ${ip} (${blacklistCheck.totalChecked} checked)`);
        
        // Потом проверяем HTTP соединение
        const httpOk = await checkProxyHttp(p);
        if (!httpOk) {
          return { proxy: p, valid: false, reason: 'HTTP check failed' };
        }
        
        return { proxy: p, valid: true, reason: 'OK' };
      } catch (err) {
        return { proxy: p, valid: false, reason: 'Error' };
      }
    })
  );

  const valid = results.filter((r) => r.valid).map((r) => r.proxy);
  const invalid = results.filter((r) => !r.valid);
  const blacklisted = invalid.filter((r) => r.reason.includes('Blacklist'));

  try {
    let added = 0;
    if (valid.length > 0) {
      added = await conversation.external((ctx) =>
        ProxyRepo.add(ctx.from!.id, valid)
      );
    }

    if (requestMsg !== true) {
      let msg = `✅ Добавлено: <b>${added}</b>\n`;
      msg += `❌ Невалидных: <b>${invalid.length}</b>`;
      if (blacklisted.length > 0) {
        msg += `\n⚠️ В blacklist: <b>${blacklisted.length}</b>`;
      }
      await requestMsg.editText(msg, { parse_mode: "HTML" });
    }
  } catch (err) {
    if (requestMsg !== true) {
      await requestMsg.editText(
        `❌ Ошибка: <code>${(err as Error).message}</code>`,
        { parse_mode: "HTML" }
      );
    }
    await conversation.halt();
    return;
  }

  // Возврат в меню
  await conversation.external(async (ctx) => {
    await Menus.middleware()(ctx, () => Promise.resolve());
    await proxiesView(ctx);
  });

  await conversation.halt();
}

composer.use(createConversation(proxyAddConv));
export default composer;
