import axios from "axios";

/**
 * Webhook manager для отправки уведомлений в auto_answer скрипт
 */

interface WebhookConfig {
  enabled: boolean;
  url: string;
  timeout: number;
}

interface NewEmailWebhookPayload {
  event: "new_email";
  timestamp: string;
  email_id: number;
  tg_user_id: number;
  tg_message_id: number;
  advert_id: number | null;
  from_email: string;
  from_name: string;
  subject: string;
  text_preview: string;
  full_text?: string;
}

interface SelectionCompletedWebhookPayload {
  event: "selection_completed";
  timestamp: string;
  tg_user_id: number;
  found_count: number;
  total_count: number;
  not_found_ids: number[];
  duration_ms: number;
}

// Конфигурация webhook (можно вынести в config.ini)
const WEBHOOK_CONFIG: WebhookConfig = {
  enabled: true, // Включить/выключить webhooks
  url: "http://localhost:8000/webhook/new_email", // URL auto_answer скрипта
  timeout: 5000, // Таймаут в миллисекундах
};

const SELECTION_WEBHOOK_URL = "http://localhost:8000/webhook/selection_completed";

/**
 * Отправляет webhook при получении нового email
 */
export async function sendNewEmailWebhook(payload: NewEmailWebhookPayload): Promise<boolean> {
  if (!WEBHOOK_CONFIG.enabled) {
    return false;
  }

  try {
    console.log(`[WEBHOOK] Отправка уведомления о новом письме (email_id: ${payload.email_id})`);
    
    const response = await axios.post(WEBHOOK_CONFIG.url, payload, {
      timeout: WEBHOOK_CONFIG.timeout,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "CrisMailer-Bot/1.0",
      },
    });

    if (response.status === 200) {
      console.log(`[WEBHOOK] ✅ Webhook успешно отправлен (email_id: ${payload.email_id})`);
      return true;
    } else {
      console.warn(`[WEBHOOK] ⚠️ Неожиданный статус ответа: ${response.status}`);
      return false;
    }
  } catch (error: any) {
    if (error.code === "ECONNREFUSED") {
      console.error(`[WEBHOOK] ❌ Не удалось подключиться к ${WEBHOOK_CONFIG.url} - сервис недоступен`);
    } else if (error.code === "ETIMEDOUT") {
      console.error(`[WEBHOOK] ❌ Таймаут при отправке webhook (${WEBHOOK_CONFIG.timeout}ms)`);
    } else {
      console.error(`[WEBHOOK] ❌ Ошибка при отправке webhook:`, error.message);
    }
    return false;
  }
}

/**
 * Проверяет доступность webhook endpoint
 */
export async function checkWebhookHealth(): Promise<boolean> {
  if (!WEBHOOK_CONFIG.enabled) {
    return false;
  }

  try {
    const healthUrl = WEBHOOK_CONFIG.url.replace("/new_email", "/health");
    const response = await axios.get(healthUrl, {
      timeout: 3000,
    });

    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Обновляет конфигурацию webhook
 */
export function updateWebhookConfig(config: Partial<WebhookConfig>) {
  Object.assign(WEBHOOK_CONFIG, config);
  console.log(`[WEBHOOK] Конфигурация обновлена:`, WEBHOOK_CONFIG);
}

/**
 * Получает текущую конфигурацию webhook
 */
export function getWebhookConfig(): WebhookConfig {
  return { ...WEBHOOK_CONFIG };
}

/**
 * Отправляет webhook при завершении подбора почт
 */
export async function sendSelectionCompletedWebhook(
  payload: SelectionCompletedWebhookPayload
): Promise<boolean> {
  if (!WEBHOOK_CONFIG.enabled) {
    return false;
  }

  try {
    console.log(
      `[WEBHOOK] Отправка уведомления о завершении подбора (user: ${payload.tg_user_id}, found: ${payload.found_count}/${payload.total_count})`
    );

    const response = await axios.post(SELECTION_WEBHOOK_URL, payload, {
      timeout: WEBHOOK_CONFIG.timeout,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "CrisMailer-Bot/1.0",
      },
    });

    if (response.status === 200) {
      console.log(
        `[WEBHOOK] ✅ Уведомление о подборе успешно отправлено (user: ${payload.tg_user_id})`
      );
      return true;
    } else {
      console.warn(`[WEBHOOK] ⚠️ Неожиданный статус ответа: ${response.status}`);
      return false;
    }
  } catch (error: any) {
    if (error.code === "ECONNREFUSED") {
      console.error(
        `[WEBHOOK] ❌ Не удалось подключиться к ${SELECTION_WEBHOOK_URL} - сервис недоступен`
      );
    } else if (error.code === "ETIMEDOUT") {
      console.error(`[WEBHOOK] ❌ Таймаут при отправке webhook (${WEBHOOK_CONFIG.timeout}ms)`);
    } else {
      console.error(`[WEBHOOK] ❌ Ошибка при отправке webhook:`, error.message);
    }
    return false;
  }
}

export type { WebhookConfig, NewEmailWebhookPayload, SelectionCompletedWebhookPayload };
