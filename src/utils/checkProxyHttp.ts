import { SocksProxyAgent } from "socks-proxy-agent";
import nodemailer from "nodemailer";

export async function checkProxyHttp(proxy: string, retries = 2): Promise<boolean> {
  let host: string, port: string, user: string, pass: string;
  
  // Поддержка двух форматов: host:port:user:pass и user:pass@host:port
  if (proxy.includes('@')) {
    // Формат: user:pass@host:port
    const [credentials, hostPort] = proxy.split('@');
    [user, pass] = credentials.split(':');
    [host, port] = hostPort.split(':');
  } else {
    // Формат: host:port:user:pass
    [host, port, user, pass] = proxy.split(':');
  }
  
  if (!host || !port || !user || !pass) {
    console.log(`[PROXY] Invalid format: ${proxy}`);
    return false;
  }

  const proxyUrl = `socks5://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  console.log(`[PROXY] Testing SMTP: ${host}:${port}`);

  // Проверка SMTP через SOCKS5 прокси
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const agent = new SocksProxyAgent(proxyUrl);
      
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        // @ts-ignore
        agent,
        auth: {
          user: "test@test.com",
          pass: "invalid"
        },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
      });

      await transporter.verify();
      // Если дошли сюда - значит прокси работает, но auth failed (это ОК)
      console.log(`[PROXY] ✅ Valid: ${host}:${port}`);
      return true;
      
    } catch (err: any) {
      const msg = err.message || String(err);
      
      // Если ошибка аутентификации - прокси работает!
      if (msg.includes('Invalid login') || msg.includes('Username and Password') || 
          msg.includes('authentication') || msg.includes('535')) {
        console.log(`[PROXY] ✅ Valid: ${host}:${port} (SMTP reachable)`);
        return true;
      }
      
      // Таймаут или connection refused - прокси не работает
      if (attempt < retries) {
        console.log(`[PROXY] Retry ${attempt}/${retries}: ${host}:${port}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  console.log(`[PROXY] ❌ Failed: ${host}:${port}`);
  return false;
}
