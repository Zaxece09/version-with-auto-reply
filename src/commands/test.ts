import { Command } from "@grammyjs/commands";
import type { CustomContext } from "../types";
import { launchSend } from "../utils/sendEmail";
import { UserRepo, EmailRepo, ProxyRepo, SmartPresetRepo, AdvertsRepo, EmailMsgRepo } from "../db/queries";
import { toProxyAuth } from "../utils/proxyForm";

const testCommand = new Command(
  "test",
  "Создать тестовое объявление и отправить письмо. Пример: /test your@email.com",
  async (ctx) => {
    try {
      // Получаем email из аргумента команды
      const args = ctx.message?.text?.split(" ").slice(1) || [];
      const targetEmail = args[0];

      if (!targetEmail || !targetEmail.includes("@")) {
        await ctx.reply("❌ Укажите email для отправки.\nПример: /test your@email.com");
        return;
      }

      await ctx.reply("🔄 Создание тестового объявления...");

      // 1. Получаем userId
      const user = await UserRepo.getUserByTelegramId(ctx.from!.id);
      if (!user) {
        await ctx.reply("❌ Пользователь не найден");
        return;
      }

      // 2. Создаем тестовое объявление
      const testAdData = {
        userId: user.id,
        title: "Test Artikel - Nike Schuhe",
        price: "25.00 EUR",
        photo: "https://img.kleinanzeigen.de/api/v1/prod-ads/images/af/aff8e3d1-8d74-433b-8989-c4299f9e17b3?rule=$_1.JPG",
        link: "https://www.kleinanzeigen.de/s-anzeige/standuhr-antik-holz/3271801859-88-2047",
        email: targetEmail,
        status: 2, // ready to send
      };

      // Создаем объявление в БД
      const personDotName = `test-${Date.now()}`;
      const created = await AdvertsRepo.add({
        userId: user.id,
        title: testAdData.title,
        price: testAdData.price,
        photo: testAdData.photo,
        link: testAdData.link,
        personDotName,
      });

      if (!created) {
        await ctx.reply("❌ Не удалось создать объявление");
        return;
      }

      // Получаем созданное объявление по personDotName
      const allAdverts = await AdvertsRepo.listPendingByTelegramId(ctx.from!.id);
      const testAd = allAdverts.find(a => a.personDotName === personDotName);
      
      if (!testAd) {
        await ctx.reply("❌ Созданное объявление не найдено");
        return;
      }

      const advertId = testAd.id;

      // Обновляем email и статус на 2 (ready)
      await AdvertsRepo.updateEmail(advertId, targetEmail);
      await AdvertsRepo.updateStatus(advertId, 2);

      await ctx.reply(`✅ Создано тестовое объявление ID: ${advertId}\n\n🔄 Подготовка отправки...`);

      // 3. Создаем тестовое сообщение в БД (имитация входящего письма)
      const senderEmail = await EmailRepo.nextValidEmail(ctx.from!.id);
      if (!senderEmail) {
        await ctx.reply("❌ Нет доступных e-mail отправителей");
        return;
      }

      await EmailMsgRepo.logSent(
        senderEmail.id,
        `<test-${Date.now()}@gmail.com>`,
        testAdData.title,
        "Hallo, ich interessiere mich für Ihren Artikel",
        "Test User",
        targetEmail,
        null,
        advertId
      );

      await ctx.reply("✅ Создано тестовое сообщение\n\n📧 Отправка письма через launchSend...");

      // 4. Берем прокси
      const picked = await ProxyRepo.nextValidProxy(ctx.from!.id);
      if (!picked) {
        await ctx.reply("❌ Нет валидных прокси");
        return;
      }
      const proxyUrl = toProxyAuth(picked.proxy);

      // 5. Смарт-пресет (опционально)
      const preset = await SmartPresetRepo.nextSmartPreset(ctx.from!.id);

      // 6. Формируем текст
      let bodyText: string;
      if (preset) {
        bodyText = preset.text.replaceAll("OFFER", testAdData.title);
      } else {
        bodyText = testAdData.title;
      }

      await ctx.reply(
        `📧 Отправляю письмо:\n\n` +
        `📤 От: <code>${senderEmail.email.split(":")[0]}</code>\n` +
        `📥 Кому: <code>${targetEmail}</code>\n` +
        `📝 Тема: ${testAdData.title}\n` +
        `💬 Текст: ${bodyText.substring(0, 100)}${bodyText.length > 100 ? '...' : ''}`,
        { parse_mode: "HTML" }
      );

      // 7. Отправляем
      await launchSend(
        ctx.from!.id,
        0,
        1,
        senderEmail.id,
        senderEmail.email,
        proxyUrl,
        senderEmail.name,
        targetEmail,
        testAdData.title,
        bodyText,
        advertId,
        true
      );

      await ctx.reply(
        `✅ Письмо отправлено!\n\n` +
        `📊 Создано:\n` +
        `  • Объявление ID: ${advertId}\n` +
        `  • Сообщение в БД\n` +
        `  • Отправлено письмо на ${targetEmail}\n\n` +
        `Теперь можно тестировать автоответ через webhook!`
      );

    } catch (error) {
      await ctx.reply(`❌ Ошибка: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

export default testCommand;
