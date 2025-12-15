import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { DB_FILE_NAME } from "../config";

const sqlite = new Database(DB_FILE_NAME);

// Включаем WAL mode для избежания блокировок
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA busy_timeout = 5000;"); // 5 секунд ожидания при блокировке

export const db = drizzle({ client: sqlite, casing: 'snake_case' });
