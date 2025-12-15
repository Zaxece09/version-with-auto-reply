import { run } from "@grammyjs/runner";
import { bot } from "./bot";
import { EmailStreamManager } from "./emailStream";
import { stopAllSends } from "./emailSender";
import { startApiServer } from "./api/server";

console.log("🚀 Бот инициализируется...");

// Глобальная обработка необработанных ошибок
process.on('uncaughtException', (err) => {
  console.error('💥 Необработанная ошибка:', err);
  console.error('   Бот продолжает работу...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Необработанное отклонение промиса:', reason);
  console.error('   Бот продолжает работу...');
});

// Запуск API сервера СРАЗУ (до EmailStreamManager)
const apiServer = startApiServer(3000);
console.log("✅ API Server запущен на http://localhost:3000");

const runner = run(bot);
EmailStreamManager.startAllForEveryone(); // Убираем await - запускаем асинхронно
console.log("✅ Cris Mailer бот запущен!");

const stopRunner = async () => {
  if (runner.isRunning()) {
    console.log("\n⛔ Остановка Cris Mailer...");
    await stopAllSends();
    await EmailStreamManager.stopAllForEveryone();
    await runner.stop();
    apiServer.stop();
    console.log("🛑 Cris Mailer бот остановлен!");
  }
};

process.once("SIGINT", stopRunner);
process.once("SIGTERM", stopRunner);
