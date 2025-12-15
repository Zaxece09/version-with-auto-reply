import { startApiServer } from "./src/api/server";

console.log("🚀 Запуск API сервера...");

const port = parseInt(process.env.API_PORT || "3000");
const server = startApiServer(port);

const stopServer = () => {
  console.log("\n⛔ Остановка API сервера...");
  server.stop();
  console.log("🛑 API сервер остановлен!");
  process.exit(0);
};

process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);

console.log("✅ API сервер готов к работе!");
console.log(`📍 Endpoint: http://localhost:${port}/api`);
console.log("\nДоступные эндпоинты:");
console.log("  POST /api/start_send");
console.log("  GET  /api/ad_info");
console.log("  POST /api/generate_link");
console.log("  POST /api/answer_message");
console.log("  GET  /api/send_status");
console.log("\nДля остановки нажмите Ctrl+C");
