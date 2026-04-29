/**
 * LLM provider factory using Vercel AI SDK.
 */

import { type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  ModelProvider,
  ModelName,
  VALID_MODELS,
  DEFAULT_MODEL,
} from "../types/enums.js";

export type { LanguageModel };

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface LLMProviderOptions {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  deepseekApiKey?: string;
  ollamaBaseURL?: string;
  openrouterApiKey?: string;
}

/**
 * Factory for Vercel AI SDK provider instances, keyed by ModelProvider enum.
 *
 * Provider SDK clients are cached per ModelProvider key — they are stateless
 * once constructed, so singleton semantics are safe. Call
 * `LLMProviderFactory.configure(options)` once at startup with API keys before
 * any `createLLMProvider()` call; without this, provider creation will throw on
 * the first LLM request.
 *
 * For simple use cases, prefer the `createLLMProvider()` convenience export.
 */
export class LLMProviderFactory {
  // Provider SDK clients are stateless once constructed, so caching is safe.
  // The cache is global to the class (static) — intentional for singleton semantics.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static instances: Map<ModelProvider, any> = new Map();
  private static options: LLMProviderOptions = {};

  static configure(options: LLMProviderOptions) {
    this.options = options;
    this.instances.clear();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static getProvider(provider: ModelProvider, config?: ProviderConfig): any {
    const cacheKey = provider;

    if (this.instances.has(cacheKey)) {
      return this.instances.get(cacheKey);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let instance: any;

    switch (provider) {
      case ModelProvider.claude:
        instance = this.createAnthropicProvider(config);
        break;
      case ModelProvider.openai:
        instance = this.createOpenAIProvider(config);
        break;
      case ModelProvider.google:
        instance = this.createGoogleProvider(config);
        break;
      case ModelProvider.deepseek:
        instance = this.createDeepSeekProvider(config);
        break;
      case ModelProvider.gemma:
        instance = this.createOllamaProvider(config);
        break;
      case ModelProvider.openrouter:
        instance = this.createOpenRouterProvider(config);
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    this.instances.set(cacheKey, instance);
    return instance;
  }

  private static createAnthropicProvider(config?: ProviderConfig) {
    const apiKey = config?.apiKey || this.options.anthropicApiKey;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for Claude provider");
    }
    console.info("Initializing Claude provider");
    return createAnthropic({ apiKey, baseURL: config?.baseURL });
  }

  private static createOpenAIProvider(config?: ProviderConfig) {
    const apiKey = config?.apiKey || this.options.openaiApiKey;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAI provider");
    }
    console.info("Initializing OpenAI provider");
    return createOpenAI({ apiKey, baseURL: config?.baseURL });
  }

  private static createGoogleProvider(config?: ProviderConfig) {
    const apiKey = config?.apiKey || this.options.googleApiKey;
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY is required for Google provider");
    }
    console.info("Initializing Google Gemini provider");
    return createGoogleGenerativeAI({ apiKey, baseURL: config?.baseURL });
  }

  private static createDeepSeekProvider(config?: ProviderConfig) {
    const apiKey = config?.apiKey || this.options.deepseekApiKey;
    if (!apiKey) {
      console.warn(
        "DEEPSEEK_API_KEY not found - DeepSeek provider may not work",
      );
    }
    console.info("Initializing DeepSeek provider");
    // DeepSeek's API is compatible with the OpenAI SDK but requires a different
    // base URL. A placeholder key is used when none is configured so the provider
    // can be instantiated — actual calls will fail with a 401 at runtime.
    // DeepSeek only supports Chat Completions, not the v3 Responses API default.
    const p = createOpenAI({
      apiKey: apiKey || "dummy-key",
      baseURL: config?.baseURL || "https://api.deepseek.com/v1",
    });
    return (model: string) => p.chat(model);
  }

  private static createOllamaProvider(config?: ProviderConfig) {
    const baseURL =
      config?.baseURL || this.options.ollamaBaseURL || "http://localhost:11434";
    console.info(`Initializing Ollama provider at ${baseURL}`);
    // Ollama only supports Chat Completions, not the v3 Responses API default.
    const p = createOpenAI({ apiKey: "not-required", baseURL });
    return (model: string) => p.chat(model);
  }

  private static createOpenRouterProvider(config?: ProviderConfig) {
    const apiKey = config?.apiKey || this.options.openrouterApiKey;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required for OpenRouter provider");
    }
    console.info("Initializing OpenRouter provider");
    // OpenRouter only supports Chat Completions, not the v3 Responses API default.
    const p = createOpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "https://openrouter.ai",
        "X-Title": "RythmicFlow",
      },
    });
    return (model: string) => p.chat(model);
  }

  static getDefaultModel(provider: ModelProvider): ModelName {
    return DEFAULT_MODEL[provider];
  }

  static resolveModelName(
    provider: ModelProvider,
    modelName?: string,
  ): ModelName {
    if (!modelName) {
      return this.getDefaultModel(provider);
    }
    // OpenRouter accepts arbitrary vendor-namespaced IDs (e.g. "openai/gpt-4o")
    // that are not in our VALID_MODELS whitelist. Skip validation for this provider.
    if (provider === ModelProvider.openrouter) {
      return modelName as ModelName;
    }
    const valid = VALID_MODELS[provider];
    if (valid.includes(modelName as ModelName)) {
      return modelName as ModelName;
    }
    const fallback = this.getDefaultModel(provider);
    console.warn(
      `Invalid model "${modelName}" for provider "${provider}", falling back to "${fallback}"`,
    );
    return fallback;
  }

  static getLanguageModel(
    provider: ModelProvider,
    modelName?: string,
    config?: ProviderConfig,
  ): LanguageModel {
    const providerInstance = this.getProvider(provider, config);
    const model = this.resolveModelName(provider, modelName);
    return providerInstance(model);
  }

  static isProviderAvailable(provider: ModelProvider): boolean {
    switch (provider) {
      case ModelProvider.claude:
        return Boolean(this.options.anthropicApiKey);
      case ModelProvider.openai:
        return Boolean(this.options.openaiApiKey);
      case ModelProvider.google:
        return Boolean(this.options.googleApiKey);
      case ModelProvider.deepseek:
        return Boolean(this.options.deepseekApiKey);
      case ModelProvider.gemma:
        return true;
      case ModelProvider.openrouter:
        return Boolean(this.options.openrouterApiKey);
      default:
        return false;
    }
  }

  static getAvailableProviders(): ModelProvider[] {
    return Object.values(ModelProvider).filter((provider) =>
      this.isProviderAvailable(provider),
    );
  }

  static getRecommendedProvider(): ModelProvider {
    const available = this.getAvailableProviders();
    const priority = [
      ModelProvider.claude,
      ModelProvider.openai,
      ModelProvider.google,
      ModelProvider.deepseek,
      ModelProvider.openrouter,
      ModelProvider.gemma,
    ];
    for (const provider of priority) {
      if (available.includes(provider)) {
        return provider;
      }
    }
    throw new Error("No LLM providers are available. Check your API keys.");
  }
}

/**
 * Convenience function that mirrors kuberag's createLLMProvider API.
 * Returns a language model instance ready for generateText().
 */
export function createLLMProvider(
  provider: ModelProvider,
  modelName?: ModelName | string,
): LanguageModel {
  return LLMProviderFactory.getLanguageModel(provider, modelName);
}

export function getAvailableProviders(): ModelProvider[] {
  return LLMProviderFactory.getAvailableProviders();
}

export function getRecommendedProvider(): ModelProvider {
  return LLMProviderFactory.getRecommendedProvider();
}
