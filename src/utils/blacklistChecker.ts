/**
 * Проверка IP адресов в email блэклистах через API dnsbl.smtp.bz
 * Проверяет 50+ блэклистов одним запросом
 */

export interface BlacklistCheckResult {
  listed: boolean;
  blacklists: string[];
  totalChecked: number;
  details?: string;
}

interface DNSBLResponse {
  blName: string;
  blHostName: string;
  blAddress: string;
  blListing: boolean;
  blMessage: string | false;
  blWorking: boolean;
  blQueryTime: number;
}

// Кэш результатов проверки (IP -> результат)
const blacklistCache = new Map<string, { result: BlacklistCheckResult; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 минут

// Защита от параллельных запросов к одному IP
const pendingChecks = new Map<string, Promise<BlacklistCheckResult>>();

/**
 * Проверяет IP адрес в множестве email блэклистов
 * @param ip - IP адрес для проверки
 * @returns Результат проверки с списком блэклистов где IP найден
 */
export async function checkProxyBlacklist(ip: string): Promise<BlacklistCheckResult> {
  // Проверяем кэш
  const cached = blacklistCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[BLACKLIST] 💾 Из кэша: ${ip}`);
    return cached.result;
  }

  // Проверяем, нет ли уже идущего запроса для этого IP
  const pending = pendingChecks.get(ip);
  if (pending) {
    console.log(`[BLACKLIST] ⏳ Ожидание запроса: ${ip}`);
    return await pending;
  }

  // Создаем новый запрос
  const checkPromise = performBlacklistCheck(ip);
  pendingChecks.set(ip, checkPromise);

  try {
    const result = await checkPromise;
    // Сохраняем в кэш
    blacklistCache.set(ip, { result, timestamp: Date.now() });
    return result;
  } finally {
    pendingChecks.delete(ip);
  }
}

/**
 * Выполняет реальную проверку IP (внутренняя функция)
 */
async function performBlacklistCheck(ip: string): Promise<BlacklistCheckResult> {
  try {
    const response = await fetch(`https://dnsbl.smtp.bz/v1/Tools/dnsbl/${ip}`, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[BLACKLIST CHECK] API вернул статус ${response.status} для ${ip}`);
      return { listed: false, blacklists: [], totalChecked: 0 };
    }

    const data: DNSBLResponse[] = await response.json();
    
    // Фильтруем только работающие блэклисты
    const workingBlacklists = data.filter(bl => bl.blWorking);
    
    // Находим где IP в блэклисте
    const listedIn = workingBlacklists.filter(bl => bl.blListing === true);

    const result: BlacklistCheckResult = {
      listed: listedIn.length > 0,
      blacklists: listedIn.map(bl => bl.blName),
      totalChecked: workingBlacklists.length,
    };

    // Добавляем детали если есть сообщения
    if (listedIn.length > 0) {
      result.details = listedIn
        .map(bl => {
          const msg = bl.blMessage ? ` (${bl.blMessage})` : '';
          return `${bl.blName}${msg}`;
        })
        .join('; ');
    }

    return result;
  } catch (error: any) {
    // При ошибке API не считаем прокси заблокированным
    // Это безопаснее чем удалять рабочие прокси
    console.error(`[BLACKLIST CHECK] Ошибка проверки ${ip}:`, error.message);
    
    return {
      listed: false,
      blacklists: [],
      totalChecked: 0,
    };
  }
}
