import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function readSecretLine(prompt: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    const rl = createInterface({ input, output, terminal: false });
    try {
      return (await rl.question(prompt)).trim();
    } finally {
      rl.close();
    }
  }

  output.write(prompt);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();

  return await new Promise<string>((resolve, reject) => {
    const chars: string[] = [];

    const cleanup = (): void => {
      input.off("data", onData);
      input.off("error", onError);
      input.off("close", onClose);
      try {
        input.setRawMode(wasRaw ?? false);
      } catch {
        return;
      }
    };

    const onData = (buf: Buffer | string): void => {
      const text = typeof buf === "string" ? buf : buf.toString("utf8");
      for (const ch of text) {
        if (ch === "\n" || ch === "\r") {
          cleanup();
          output.write("\n");
          resolve(chars.join("").trim());
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          output.write("\n");
          reject(new Error("Login cancelled."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          chars.pop();
          continue;
        }
        if (ch >= " ") chars.push(ch);
      }
    };

    const onError = (error: Error): void => {
      cleanup();
      output.write("\n");
      reject(error);
    };

    const onClose = (): void => {
      cleanup();
      output.write("\n");
      reject(new Error("Login cancelled."));
    };

    input.on("data", onData);
    input.on("error", onError);
    input.on("close", onClose);
  });
}
