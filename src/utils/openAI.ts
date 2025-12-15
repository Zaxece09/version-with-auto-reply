import OpenAI from "openai";
import { DEEPSEEK_API_KEY } from "../config";

// Создаём клиента
const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: DEEPSEEK_API_KEY,
});

export async function translateToRussian(text: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "Ты профессиональный переводчик. Переводи любой текст на русский язык, сохраняя смысл, стиль и контекст. Не добавляй ничего от себя.",
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  // Безопасно извлекаем ответ
  const translated = completion.choices[0]?.message?.content?.trim() ?? "";
  return translated;
}

export async function chatWithAI(prompt: string, history: any[] = []): Promise<string> {
  const messages = [
    ...history,
    {
      role: "user" as const,
      content: prompt,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "deepseek-chat",
    messages,
    temperature: 0.3,
  });

  const response = completion.choices[0]?.message?.content?.trim() ?? "";
  return response;
}