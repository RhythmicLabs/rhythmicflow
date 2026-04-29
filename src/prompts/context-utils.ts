export interface ProcessedContext {
  text: string;
  tokens: number;
}

export function processUserContext(context: string[]): ProcessedContext {
  const text = context.join("\n");
  const tokens = Math.ceil(text.length / 4);
  return { text, tokens };
}
