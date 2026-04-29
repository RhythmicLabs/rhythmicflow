export enum ModelProvider {
  claude = "claude",
  gemma = "gemma",
  deepseek = "deepseek",
  openai = "openai",
  google = "google",
  openrouter = "openrouter",
}

export enum ModelName {
  CLAUDE_SONNET = "claude-4-5-sonnet-latest",
  CLAUDE_HAIKU = "claude-haiku-4-5-20251001",
  CLAUDE_OPUS = "claude-opus-4-6",
  GPT_4O = "gpt-4o",
  GPT_4O_MINI = "gpt-4o-mini",
  GEMINI_FLASH = "gemini-2.0-flash",
  GEMINI_PRO = "gemini-2.0-pro",
  DEEPSEEK_CHAT = "deepseek-chat",
  DEEPSEEK_REASONER = "deepseek-reasoner",
  GEMMA_9B = "gemma2:9b-instruct",
  OPENROUTER_DEFAULT = "openai/gpt-4o-mini",
}

export const VALID_MODELS: Record<ModelProvider, ModelName[]> = {
  [ModelProvider.claude]: [
    ModelName.CLAUDE_SONNET,
    ModelName.CLAUDE_HAIKU,
    ModelName.CLAUDE_OPUS,
  ],
  [ModelProvider.openai]: [ModelName.GPT_4O, ModelName.GPT_4O_MINI],
  [ModelProvider.google]: [ModelName.GEMINI_FLASH, ModelName.GEMINI_PRO],
  [ModelProvider.deepseek]: [
    ModelName.DEEPSEEK_CHAT,
    ModelName.DEEPSEEK_REASONER,
  ],
  [ModelProvider.gemma]: [ModelName.GEMMA_9B],
  [ModelProvider.openrouter]: [],
};

export const DEFAULT_MODEL: Record<ModelProvider, ModelName> = {
  [ModelProvider.claude]: ModelName.CLAUDE_SONNET,
  [ModelProvider.openai]: ModelName.GPT_4O_MINI,
  [ModelProvider.google]: ModelName.GEMINI_FLASH,
  [ModelProvider.deepseek]: ModelName.DEEPSEEK_CHAT,
  [ModelProvider.gemma]: ModelName.GEMMA_9B,
  [ModelProvider.openrouter]: ModelName.OPENROUTER_DEFAULT,
};
