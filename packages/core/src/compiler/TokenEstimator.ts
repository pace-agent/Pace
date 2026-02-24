import type { Message } from "../types/llm.js";

export class TokenEstimator {
  estimate(text: string): number {
    return Math.ceil(text.length / 4);
  }

  estimateMessages(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.estimate(msg.content), 0);
  }
}
