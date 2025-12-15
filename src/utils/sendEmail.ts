// send-email.ts
import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import type { CustomContext } from "../types";
import { EmailMsgRepo, ProxyRepo, AdvertsRepo, UserRepo } from "../db/queries";
import { toProxyAuth } from "../utils/proxyForm";
import { InputFile } from "grammy";
import { bot } from "../bot";
import { SocksProxyAgent } from "socks-proxy-agent";

import { isUserSending } from "../emailSender";

/**
 * Удаляет zero-width символы из строки
 */
function removeZeroWidthChars(str: string): string {
  return str.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/**
 * Конвертирует HTML в простой текст (убирает теги)
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // удаляем стили
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // удаляем скрипты
    .replace(/<[^>]+>/g, '') // удаляем HTML теги
    .replace(/&nbsp;/g, ' ') // заменяем nbsp на пробел
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n/g, '\n\n') // убираем множественные переносы
    .trim();
}

// ниже, рядом с утилитами
const makeHtmlFile = (html: string, filename = "message.html") =>
  new InputFile(Buffer.from(html, "utf8"), filename);

const safeFileName = (raw?: string) => {
  const base =
    (raw || "message").replace(/[^\p{L}\p{N}\-_. ]/gu, "").trim() || "message";
  return `${base.slice(0, 60)}.html`;
};

// низкоуровневая отправка
export async function sendEmail(options: {
  login: string;
  appPassword: string;
  proxy?: string; // "http://user:pass@host:port" или без
  displayName: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  enableLogging?: boolean; // для детального логирования
}) {
  const {
    login,
    appPassword,
    proxy,
    displayName,
    to,
    subject,
    text,
    html,
    inReplyTo,
    enableLogging = false,
  } = options;

  const domain = login.split("@")[1]?.toLowerCase();
  let host: string;
  let port: number;
  let secure: boolean;

  switch (domain) {
    case "gmail.com":
      host = "smtp.gmail.com";
      port = 465;
      secure = true;
      break;
    case "yahoo.com":
      host = "smtp.mail.yahoo.com";
      port = 465;
      secure = true;
      break;
    case "outlook.com":
    case "hotmail.com":
    case "live.com":
      host = "smtp.office365.com";
      port = 587;
      secure = false;
      break;
    case "icloud.com":
    case "me.com":
    case "mac.com":
      host = "smtp.mail.me.com";
      port = 465;
      secure = true;
      break;
    case "gmx.net":
    case "gmx.de":
    case "gmx.com":
    case "gmx.at":
    case "gmx.ch":
      host = "mail.gmx.net";
      port = 587;
      secure = false; // STARTTLS
      break;
    default:
      host = `smtp.${domain}`;
      port = 465;
      secure = true;
      break;
  }

  if (enableLogging) {
    console.log(`[SMTP] ============================================`);
    console.log(`[SMTP] Настройка SMTP соединения:`);
    console.log(`[SMTP]   Host: ${host}`);
    console.log(`[SMTP]   Port: ${port}`);
    console.log(`[SMTP]   Secure: ${secure}`);
    console.log(`[SMTP]   Login: ${login}`);
    console.log(`[SMTP]   DisplayName: ${displayName}`);
    console.log(`[SMTP]   To: ${to}`);
    console.log(`[SMTP]   Subject: ${subject}`);
    console.log(`[SMTP]   Proxy: ${proxy || 'нет'}`);
    console.log(`[SMTP] ============================================`);
  }

  // Создаем SOCKS5 агент если используется прокси
  let agent;
  if (proxy) {
    // Убеждаемся что прокси в формате user:pass@host:port
    let proxyUrl = proxy;
    
    // Если уже есть socks префикс - используем как есть
    if (!proxyUrl.startsWith("socks")) {
      // Добавляем socks5:// префикс
      proxyUrl = `socks5://${proxyUrl}`;
    }
    
    console.log(`[SMTP] SOCKS5 URL: ${proxyUrl}`);
    agent = new SocksProxyAgent(proxyUrl);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: login, pass: appPassword },
    ...(agent ? { agent } : {}),
    connectionTimeout: 15000, // 15 секунд на подключение
    greetingTimeout: 15000,   // 15 секунд на приветствие
    socketTimeout: 30000,     // 30 секунд на операции
    ...(enableLogging ? { logger: true, debug: true } : {}),
  } as SMTPTransport.Options);

  if (enableLogging) {
    console.log(`[SMTP] Подключение к ${host}:${port}...`);
  }

  // Очищаем displayName от zero-width символов перед отправкой
  const cleanDisplayName = removeZeroWidthChars(displayName);

  // Если есть HTML но нет текста - создаем текстовую версию
  let finalText = text;
  if (html && !text) {
    finalText = htmlToPlainText(html);
  }

  // Формируем письмо с правильными заголовками
  // Убираем X-Mailer полностью - Gmail детектит подделку
  
  const mailOptions: any = {
    from: `"${cleanDisplayName}" <${login}>`,
    to,
    subject,
    headers: {
      'X-Priority': '3',
      'Importance': 'Normal',
      ...(html ? {
        'List-Unsubscribe': '<mailto:noreply@kleinanzeigen.de>',
        'Precedence': 'bulk',
      } : {}),
    },
    ...(inReplyTo ? { 
      inReplyTo,
      references: inReplyTo,
    } : {}),
  };

  // Если есть HTML - отправляем multipart (текст + HTML)
  if (html) {
    mailOptions.text = finalText;
    mailOptions.html = html;
  } else {
    // Только текст
    mailOptions.text = finalText;
  }

  const sendStart = Date.now();
  const result = await transporter.sendMail(mailOptions);
  const sendTime = Date.now() - sendStart;

  if (enableLogging) {
    console.log(`[SMTP] ============================================`);
    console.log(`[SMTP] Письмо успешно отправлено!`);
    console.log(`[SMTP]   Message ID: ${result.messageId}`);
    console.log(`[SMTP]   Response: ${result.response}`);
    console.log(`[SMTP]   Send Time: ${sendTime}ms`);
    console.log(`[SMTP]   Accepted: ${result.accepted?.join(', ') || 'N/A'}`);
    console.log(`[SMTP]   Rejected: ${result.rejected?.join(', ') || 'нет'}`);
    console.log(`[SMTP] ============================================`);
  }

  return {
    success: true,
    messageId: result.messageId,
    response: result.response,
    accepted: result.accepted,
    rejected: result.rejected,
  };
}

// классификатор сетевых/прокси-ошибок — на экспорт (вдруг пригодится снаружи)
export function isConnectionError(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  const CODES = new Set([
    "ECONNECTION",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "ESOCKET",
    "EPIPE",
  ]);
  return (
    CODES.has(code) ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("proxy") ||
    msg.includes("socks") ||
    msg.includes("tunneling") ||
    msg.includes("failed to setup proxy connection") ||
    msg.includes("connection closed") ||
    msg.includes("disconnected before secure tls") ||
    msg.includes("network socket disconnected") ||
    msg.includes("getaddrinfo")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const defaultBackoff = (attempt: number) => 1000 * attempt;

/** 🔁 Универсальная отправка с ретраями/бэкоффом. Без побочных эффектов. */
export async function sendWithRetry(options: {
  login: string;
  appPassword: string;
  proxy?: string;
  displayName: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  retries?: number; // по умолчанию 3
  backoffMs?: (attempt: number) => number; // по умолчанию линейный 1s, 2s, 3s
  enableLogging?: boolean;
}) {
  const { retries = 5, backoffMs = defaultBackoff, enableLogging = false, ...mail } = options;

  // Очищаем displayName от zero-width символов
  const cleanMail = {
    ...mail,
    displayName: removeZeroWidthChars(mail.displayName)
  };

  let lastError: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (enableLogging && attempt > 1) {
        console.log(`[SENDWITHRETRY] Попытка ${attempt} из ${retries}`);
      }
      const info = await sendEmail({ ...cleanMail, enableLogging });
      return { info, attempt };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        if (enableLogging) {
          console.log(`[SENDWITHRETRY] Ошибка, повтор через ${backoffMs(attempt)}ms`);
        }
        await sleep(backoffMs(attempt));
      } else if (enableLogging) {
        console.error(`[SENDWITHRETRY] Все попытки исчерпаны`, err);
      }
    }
  }
  throw lastError;
}

// pre-send-email.ts

export async function preSendEmail(
  ctx: CustomContext,
  mailId: number,
  text?: string, // ← можно не передавать
  html?: string // ← можно передать только его
): Promise<void> {
  const tgId = ctx.from!.id;

  const msgRow = await EmailMsgRepo.getFullMessage(mailId);
  if (!msgRow) {
    await ctx.reply(`❌ Message with id=${mailId} not found`).catch(() => {});
    return;
  }

  // Разделяем по первому двоеточию (пароль может содержать пробелы)
  const colonIndex = msgRow.email.indexOf(":");
  if (colonIndex === -1) {
    await ctx
      .reply(`❌ Invalid email format in DB: ${msgRow.email}`)
      .catch(() => {});
    return;
  }
  const login = msgRow.email.substring(0, colonIndex);
  const appPassword = msgRow.email.substring(colonIndex + 1);
  
  if (!login || !appPassword) {
    await ctx
      .reply(`❌ Invalid email format in DB: ${msgRow.email}`)
      .catch(() => {});
    return;
  }

  // берём прокси (если прокси подаешь снаружи — этот блок убери)
  const picked = await ProxyRepo.nextValidProxy(tgId);
  if (!picked) {
    await ctx.reply("❌ Нет валидных прокси для отправки.").catch(() => {});
    return;
  }
  const proxyUrl = toProxyAuth(picked.proxy);

  // префикс для статуса, чтобы не сыпать HTML в превью
  const contentLabel =
    text && text.trim().length > 0
      ? `<code>${text}</code>`
      : html
        ? "<i>[HTML]</i>"
        : "<i>[empty]</i>";

  const flags = await UserRepo.getFlags(ctx.from!.id);
  let senderName: string;
  if (html) {
    senderName = flags.spoofMode
      ? await UserRepo.getSpoofName(ctx.from!.id)
      : msgRow.name;
  } else {
    senderName = msgRow.name;
  }

  // стартовое уведомление
  const sent = await ctx.reply(
    `<b>Ответ:</b> ${contentLabel} <b>идет отправка</b> <code>${msgRow.emailFrom}</code> ⏳`,
    {
      parse_mode: "HTML",
      reply_parameters: {
        message_id: msgRow.tgMsgId,
        allow_sending_without_reply: true,
      },
    }
  );

  // ⚡️ фон
  void (async () => {
    try {
      const { info } = await sendWithRetry({
        login,
        appPassword,
        proxy: proxyUrl,
        displayName: senderName,
        to: msgRow.emailFrom,
        subject: msgRow.subject,
        text: text || undefined, // ← если текста нет — не отправляем
        html: html || undefined, // ← можно отправлять только HTML
        inReplyTo: msgRow.msgId,
        retries: 5,
      });

      await sent
        .editText(
          `<b>Ответ:</b> ${contentLabel} <b>успешно отправлен пользователю</b> <code>${msgRow.emailFrom}</code> ⚡️`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});

      if (html && html.trim().length > 0) {
        const file = makeHtmlFile(html, safeFileName(msgRow.subject));
        await ctx.api
          .sendDocument(ctx.chat!.id, file, {
            caption: "📎 HTML, который был отправлен",
            parse_mode: "HTML",
            reply_parameters: {
              message_id: sent.message_id,
              allow_sending_without_reply: true,
            },
          })
          .catch(() => {});
      }

      await EmailMsgRepo.logSent(
        msgRow.emailId,
        String(info.messageId),
        msgRow.subject,
        msgRow.text,
        msgRow.senderName,
        login,
        sent.message_id,
        msgRow.advertId ?? null
      );
    } catch (err: any) {
      await sent
        .editText(
          `<b>Ответ:</b> ${contentLabel} <b>ошибка при отправке письма</b> <code>${msgRow.emailFrom}</code> <code>${err?.message ?? err?.code ?? "UNKNOWN"}</code> ❌`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }
  })();
}

export async function launchSend(
  telegramId: number,
  waitSec: number,
  leftBefore: number,
  emailId: number,
  email: string,
  proxyUrl: string,
  senderName: string,
  to: string,
  subject: string,
  text: string,
  advertId: number,
  enableLogging = false
): Promise<void> {
  // Разделяем по первому двоеточию (пароль может содержать пробелы)
  const colonIndex = email.indexOf(":");
  if (colonIndex === -1) {
    await bot.api
      .sendMessage(telegramId, `❌ Invalid email format in DB: ${email}`)
      .catch(() => {});
    return;
  }
  const login = email.substring(0, colonIndex);
  const appPassword = email.substring(colonIndex + 1);
  
  if (!login || !appPassword) {
    await bot.api
      .sendMessage(telegramId, `❌ Invalid email format in DB: ${email}`)
      .catch(() => {});
    return;
  }

  // const sent = await bot.api.sendMessage(
  //   telegramId,
  //   `<b>Сообщение:</b> <code>${text}</code> <b>идет отправка</b> <code>${to}</code> ⏳`,
  //   { parse_mode: "HTML" }
  // );
  // ⚡️ фон
  void (async () => {
    try {
      if (enableLogging) {
        console.log(`[LAUNCHSEND] Начало отправки письма через sendWithRetry`);
      }

      const { info } = await sendWithRetry({
        login,
        appPassword,
        proxy: proxyUrl, // или прокси снаружи
        displayName: senderName,
        to: to,
        subject: subject,
        text: text,
        retries: 5,
        enableLogging,
      });

      if (enableLogging) {
        console.log(`[LAUNCHSEND] Письмо успешно отправлено, сохраняем в БД`);
      }

      // await sent.editText(
      //   `<b>Сообщение:</b> <code>${text}</code> <b>успешно отправлено пользователю</b> <code>${to}</code> ⚡️`,
      //   { parse_mode: "HTML" }
      // )
      //   .catch(() => { });

      await EmailMsgRepo.logSent(
        emailId,
        String(info.messageId),
        subject,
        text,
        senderName,
        login,
        null,
        advertId
      );

      await AdvertsRepo.setStatus(advertId, 3);
    } catch (err: any) {
      await bot.api
        .sendMessage(
          telegramId,
          `<b>Сообщение:</b> <code>${text}</code> <b>ошибка при отправке письма</b> <code>${to}</code> <code>${err?.message ?? err?.code ?? "UNKNOWN"}</code> ❌`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }
  })();
}
