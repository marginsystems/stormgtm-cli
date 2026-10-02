export class SseDecoder {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const held = this.buffer.endsWith("\r") ? "\r" : "";
    const text = (held ? this.buffer.slice(0, -1) : this.buffer).replace(/\r\n?/g, "\n");
    const frames = text.split("\n\n");
    this.buffer = frames.pop()! + held;
    return frames.flatMap(frameData);
  }

  flush(): string[] {
    const rest = this.buffer.replace(/\r\n?/g, "\n");
    this.buffer = "";
    return frameData(rest);
  }
}

function frameData(frame: string): string[] {
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line === "data") data.push("");
    else if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
  }
  return data.length ? [data.join("\n")] : [];
}
