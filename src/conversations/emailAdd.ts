import { Composer } from "grammy";
import { type Conversation, createConversation } from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import Menus from "../menus";
import { emailsView } from "../views/settings";
import { EmailRepo } from "../db/queries";
import { EmailStreamManager } from "../emailStream";

// Проверяем строку формата email:password
export async function checkEmail(raw: string): Promise<boolean> {
  try {
    if (!raw || raw.length > 256) return false;

    // Разделяем по первому двоеточию
    const colonIndex = raw.indexOf(":");
    if (colonIndex === -1) return false;

    const email = raw.substring(0, colonIndex).trim();
    const pass = raw.substring(colonIndex + 1).trim();
    
    if (!email || !pass) return false;

    // Запрещаем ; , пробелы ТОЛЬКО в email части
    if (/[;, ]/.test(email)) return false;

    // проверка email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;

    return true;
  } catch {
    return false;
  }
}

const composer = new Composer<CustomContext>();

function validateName(name: string): boolean {
  if (!name) return false;
  if (name.length > 64) return false;
  if (name.includes("::") || name.includes("..")) return false;
  return true;
}

async function emailAddConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext,
  page: number
) {
  const chooseMenu = conversation
    .menu("choose", { autoAnswer: false })
    .text("1️⃣ Одно имя", async (ctx) => {
      const cancelMenu = conversation
        .menu("cancel-single", { autoAnswer: false })
        .text("🚫 Отмена", async (ctx) => {
          await ctx.menu.close();
          await Menus.middleware()(ctx, () => Promise.resolve());
          await ctx.answerCallbackQuery("⚡️ Действие отменено");
          await emailsView(ctx, page);
          await conversation.halt();
        });

      await ctx.editMessageText(
        "✍️ Введите имя и фамилию (например: <code>Jessy Jackson</code>)",
        { parse_mode: "HTML", reply_markup: cancelMenu }
      );

      const nameAns = await conversation.waitFor(":text");
      const name = nameAns.msg.text.trim();
      await nameAns.deleteMessage();

      if (!validateName(name)) {
        await ctx.editMessageText(
          "❌ Некорректное имя. До 64 символов, без двойных точек/двоеточий."
        );
        await emailsView(ctx, page);
        await conversation.halt();
        return;
      }

      await ctx.editMessageText(
        "📧 Отправьте список email:password (каждый с новой строки):",
        { parse_mode: "HTML", reply_markup: cancelMenu }
      );

      const listAns = await conversation.waitFor(":text");
      const rawList = listAns.msg.text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      await listAns.deleteMessage();

      const results = await Promise.all(
        rawList.map(async (line) => {
          const ok = await checkEmail(line);
          if (!ok) {
            return { name: name ?? "", email: line ?? "", valid: false };
          }
          // Разделяем только по первому двоеточию (пароль может содержать пробелы)
          const colonIndex = line.indexOf(":");
          if (colonIndex === -1) {
            return { name: name ?? "", email: line ?? "", valid: false };
          }
          const email = line.substring(0, colonIndex).trim();
          const pass = line.substring(colonIndex + 1).trim();
          return { name: name ?? "", email: `${email}:${pass}`, valid: true };
        })
      );

      const valid = results.filter((r) => r.valid);
      const invalid = results.filter((r) => !r.valid);

      if (valid.length > 0) {
        await conversation.external((ctx) =>
          EmailRepo.add(
            ctx.from!.id,
            valid.map((r) => ({ name: r.name ?? "", email: r.email ?? "" }))
          )
        );
      }

      await ctx.editMessageText("Идет синхронизация почт ⛓️", {
        parse_mode: "HTML",
      });

      // await ctx.reply(
      //   `✅ Добавлено: ${valid.length}\n❌ Невалидных: ${invalid.length}`,
      //   { parse_mode: "HTML" }
      // );
      await EmailStreamManager.syncWithDb(ctx.from.id);

      await ctx.deleteMessage();

      await Menus.middleware()(ctx, () => Promise.resolve());
      await emailsView(ctx, 999);
      await conversation.halt();
    })
    //     .text("🔢 Разные имена", async (ctx) => {
    //       const cancelMenu = conversation
    //         .menu("cancel-multi", { autoAnswer: false })
    //         .text("🚫 Отмена", async (ctx) => {
    //           await ctx.menu.close();
    //           await Menus.middleware()(ctx, () => Promise.resolve());
    //           await ctx.answerCallbackQuery("⚡️ Действие отменено");
    //           await emailsView(ctx, page);
    //           await conversation.halt();
    //         });

    //       await ctx.editMessageText(
    //         "✍️ Отправьте список в формате:\n<code>Имя Фамилия:email:password</code>",
    //         { parse_mode: "HTML", reply_markup: cancelMenu }
    //       );

    //       const listAns = await conversation.waitFor(":text");
    //       const rawList = listAns.msg.text
    //         .split("\n")
    //         .map((l) => l.trim())
    //         .filter(Boolean);
    //       await listAns.deleteMessage();

    //       const results = await Promise.all(
    //         rawList.map(async (line) => {
    //           const parts = line.split(":");
    //           if (parts.length !== 3) {
    //             return { name: line ?? "", email: line ?? "", valid: false };
    //           }

    //           const [fullNameRaw, emailRaw, passRaw] = parts.map((p) => p.trim());
    //           const fullName = fullNameRaw ?? "";
    // const email = emailRaw ?? "";
    // const pass = passRaw ?? "";

    // const ok = validateName(fullName) && (await checkEmail(`${email}:${pass}`));

    //           if (!ok) {
    //             return {
    //               name: fullNameRaw ?? "",
    //               email: line ?? "",
    //               valid: false,
    //             };
    //           }

    //           return {
    //             name: fullNameRaw ?? "",
    //             email: `${emailRaw}:${passRaw}`,
    //             valid: true,
    //           };
    //         })
    //       );

    //       const valid = results.filter((r) => r.valid);
    //       const invalid = results.filter((r) => !r.valid);

    //       if (valid.length > 0) {
    //         await conversation.external((ctx) =>
    //           EmailRepo.add(
    //             ctx.from!.id,
    //             valid.map((r) => ({
    //               name: r.name ?? "",
    //               email: r.email ?? "",
    //             }))
    //           )
    //         );
    //       }

    //       await ctx.deleteMessage();
    //       await ctx.reply(
    //         `✅ Добавлено: ${valid.length}\n❌ Невалидных: ${invalid.length}`,
    //         { parse_mode: "HTML" }
    //       );

    //       await Menus.middleware()(ctx, () => Promise.resolve());
    //       await emailsView(ctx, 999);
    //       await conversation.halt();
    //     })
    .row()
    .text("🚫 Отмена", async (ctx) => {
      await ctx.menu.close();
      await Menus.middleware()(ctx, () => Promise.resolve());
      await ctx.answerCallbackQuery("⚡️ Действие отменено");
      await emailsView(ctx, page);
      await conversation.halt();
    });

  await ctx.editMessageText("📧 Выберите способ добавления e-mail:", {
    parse_mode: "HTML",
    reply_markup: chooseMenu,
  });

  await conversation.waitUntil(() => false, {
    otherwise: async (ctx) => {
      if (ctx.callbackQuery) return;
      await ctx.deleteMessage().catch(() => {});
    },
  });
}

composer.use(createConversation(emailAddConv));
export default composer;
