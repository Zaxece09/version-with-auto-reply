import { Command } from "@grammyjs/commands";
import type { CustomContext } from "../types";
import { EmailRepo, ProxyRepo, SmartPresetRepo } from "../db/queries";
import { sendEmail, sendWithRetry } from "../utils/sendEmail";
import { toProxyAuth } from "../utils/proxyForm";

const testallCommand = new Command(
  "testall",
  "Отправить тестовое письмо с КАЖДОЙ email-почты. Пример: /testall target@email.com",
  async (ctx) => {
    try {
      // Получаем целевой email из аргумента
      const args = ctx.message?.text?.split(" ").slice(1) || [];
      const targetEmail = args[0];

      if (!targetEmail || !targetEmail.includes("@")) {
        await ctx.reply("❌ Укажите email для отправки.\nПример: /testall your@email.com");
        return;
      }

      await ctx.reply("🔄 Получаю список всех email-аккаунтов...");

      // Получаем ВСЕ email-аккаунты пользователя
      const allEmails = await EmailRepo.list(ctx.from!.id);
      
      if (!allEmails || allEmails.length === 0) {
        await ctx.reply("❌ У вас нет добавленных email-аккаунтов");
        return;
      }

      // Получаем все смарт-пресеты для рандомного выбора
      const allPresets = await SmartPresetRepo.list(ctx.from!.id);
      
      if (!allPresets || allPresets.length === 0) {
        await ctx.reply("❌ У вас нет смарт-пресетов. Создайте хотя бы один для тестовой рассылки.");
        return;
      }

      await ctx.reply(`📧 Найдено email-аккаунтов: ${allEmails.length}\n📝 Смарт-пресетов: ${allPresets.length}\n\n🚀 Начинаю рассылку...`);

      let successCount = 0;
      let failCount = 0;

      // Отправляем письмо с каждого email
      for (const emailData of allEmails) {
        try {
          // Парсим email:password
          const [login, appPassword] = emailData.email.split(":");
          if (!login || !appPassword) {
            await ctx.reply(`⚠️ Неверный формат: ${emailData.email}`);
            failCount++;
            continue;
          }

          // Берем случайный прокси
          const picked = await ProxyRepo.nextValidProxy(ctx.from!.id);
          if (!picked) {
            await ctx.reply(`⚠️ Нет прокси для ${login}`);
            failCount++;
            continue;
          }
          const proxyUrl = toProxyAuth(picked.proxy);

          // Выбираем случайный пресет
          const randomPreset = allPresets[Math.floor(Math.random() * allPresets.length)];
          const fakeTitle = `Test Offer ${Math.floor(Math.random() * 1000)}`;
          const subject = randomPreset.text.replaceAll("OFFER", fakeTitle);
          const text = subject; // Используем тот же текст

          await ctx.reply(`📤 Отправка с ${login}...\n📝 Тема: "${subject.substring(0, 50)}..."`);

          // Получаем имя отправителя из БД или используем дефолтное
          const displayName = emailData.name || "Test User";

          // Отправляем письмо как в реальной рассылке
          const result = await sendWithRetry({
            login,
            appPassword,
            proxy: proxyUrl,
            displayName,
            to: targetEmail,
            subject,
            text,
            retries: 3,
          });

          if (result.info) {
            await ctx.reply(`✅ ${login} - успешно отправлено!`);
            successCount++;
          } else {
            await ctx.reply(`❌ ${login} - ошибка отправки`);
            failCount++;
          }

          // Небольшая задержка между отправками
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (err: any) {
          await ctx.reply(`❌ ${emailData.email}: ${err.message || String(err)}`);
          failCount++;
        }
      }

      // Итоговый отчет
      await ctx.reply(`
📊 <b>Рассылка завершена!</b>

✅ Успешно: <b>${successCount}</b>
❌ Ошибок: <b>${failCount}</b>
📧 Всего: <b>${allEmails.length}</b>

🎯 Целевой email: <code>${targetEmail}</code>
      `.trim(), { parse_mode: "HTML" });

    } catch (err: any) {
      console.error("[TEST ALL] Error:", err);
      await ctx.reply(`❌ Ошибка: ${err.message || String(err)}`);
    }
  }
);

export default testallCommand;
