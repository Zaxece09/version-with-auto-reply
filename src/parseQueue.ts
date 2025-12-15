import { bot } from './bot';

export interface ParsingTask {
  userId: number;
  fileNumber: 1 | 2;
  status: 'waiting' | 'parsing' | 'completed' | 'failed';
  startedAt: Date;
  fileId?: string;
  fileName?: string;
  completedAt?: Date;
}

class ParseQueue {
  private queue: Map<string, ParsingTask> = new Map();

  getTaskId(userId: number, fileNumber: 1 | 2): string {
    return `${userId}_${fileNumber}`;
  }

  startParsing(userId: number, fileNumber: 1 | 2): ParsingTask {
    const taskId = this.getTaskId(userId, fileNumber);
    
    const task: ParsingTask = {
      userId,
      fileNumber,
      status: 'parsing',
      startedAt: new Date(),
    };

    this.queue.set(taskId, task);
    console.log(`[ParseQueue] Started parsing task: ${taskId}`);
    
    return task;
  }

  completeTask(userId: number, fileNumber: 1 | 2, fileId: string, fileName: string): ParsingTask | null {
    const taskId = this.getTaskId(userId, fileNumber);
    const task = this.queue.get(taskId);

    if (!task) {
      console.error(`[ParseQueue] Task not found: ${taskId}`);
      return null;
    }

    task.status = 'completed';
    task.fileId = fileId;
    task.fileName = fileName;
    task.completedAt = new Date();

    this.queue.set(taskId, task);
    console.log(`[ParseQueue] Completed task: ${taskId}, file: ${fileName}`);

    return task;
  }

  failTask(userId: number, fileNumber: 1 | 2, reason: string): void {
    const taskId = this.getTaskId(userId, fileNumber);
    const task = this.queue.get(taskId);

    if (task) {
      task.status = 'failed';
      task.completedAt = new Date();
      this.queue.set(taskId, task);
      console.error(`[ParseQueue] Task failed: ${taskId}, reason: ${reason}`);
    }
  }

  getTask(userId: number, fileNumber: 1 | 2): ParsingTask | null {
    const taskId = this.getTaskId(userId, fileNumber);
    return this.queue.get(taskId) || null;
  }

  getAllTasks(): ParsingTask[] {
    return Array.from(this.queue.values());
  }

  async forwardFileToUser(userId: number, fileId: string, fileName: string): Promise<void> {
    try {
      console.log(`[ParseQueue] Forwarding file ${fileName} to user ${userId}`);
      
      await bot.api.sendDocument(userId, fileId, {
        caption: `📄 Parsed file: ${fileName}\n\nFile ready for mailing.`,
      });

      console.log(`[ParseQueue] File forwarded successfully to ${userId}`);
    } catch (error) {
      console.error(`[ParseQueue] Error forwarding file:`, error);
      throw error;
    }
  }

  async notifyPythonWebhook(event: string, data: any): Promise<void> {
    const PYTHON_WEBHOOK_URL = process.env.PYTHON_WEBHOOK_URL || 'http://localhost:8000';
    
    try {
      console.log(`[ParseQueue] Notifying Python: ${event}`, data);
      
      const response = await fetch(`${PYTHON_WEBHOOK_URL}/parsing/${event}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status}`);
      }

      console.log(`[ParseQueue] Python notified successfully: ${event}`);
    } catch (error) {
      console.error(`[ParseQueue] Error notifying Python:`, error);
      // Don't throw - webhook failures shouldn't break the flow
    }
  }
}

export const parseQueue = new ParseQueue();
