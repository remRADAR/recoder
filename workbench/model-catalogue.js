/*
 * </recode> model catalogue
 *
 * Data-only provider/model metadata used by the workbench provider picker.
 * No credentials are stored here. The catalogue is intentionally plain
 * browser JavaScript so the static workbench can load it without a bundler.
 */
(function (root) {
  'use strict';

  const providers = [
    {
      id: 'openai', name: 'OpenAI', kind: 'openai',
      base: 'https://api.openai.com/v1', keyHint: 'sk-…',
      models: [
        ['gpt-5', 'GPT-5', 400000, true, true],
        ['gpt-5-mini', 'GPT-5 mini', 400000, true, true],
        ['gpt-4.1', 'GPT-4.1', 1047576, true, false],
        ['gpt-4.1-mini', 'GPT-4.1 mini', 1047576, true, false],
        ['gpt-4o', 'GPT-4o', 128000, true, false],
        ['o3-mini', 'o3-mini', 200000, false, true]
      ]
    },
    {
      id: 'anthropic', name: 'Anthropic', kind: 'anthropic',
      base: 'https://api.anthropic.com/v1', keyHint: 'sk-ant-…',
      models: [
        ['claude-opus-4-1-20250805', 'Claude Opus 4.1', 200000, true, true],
        ['claude-sonnet-4-20250514', 'Claude Sonnet 4', 200000, true, true],
        ['claude-3-7-sonnet-latest', 'Claude 3.7 Sonnet', 200000, true, true],
        ['claude-3-5-sonnet-latest', 'Claude 3.5 Sonnet', 200000, true, false],
        ['claude-3-5-haiku-latest', 'Claude 3.5 Haiku', 200000, true, false],
        ['claude-3-haiku-20240307', 'Claude 3 Haiku', 200000, false, false]
      ]
    },
    {
      id: 'google', name: 'Google Gemini', kind: 'gemini',
      base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyHint: 'AIza…',
      models: [
        ['gemini-2.5-pro', 'Gemini 2.5 Pro', 1048576, true, true],
        ['gemini-2.5-flash', 'Gemini 2.5 Flash', 1048576, true, true],
        ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 1048576, true, false],
        ['gemini-2.0-flash', 'Gemini 2.0 Flash', 1048576, true, false],
        ['gemini-2.0-flash-lite', 'Gemini 2.0 Flash-Lite', 1048576, true, false],
        ['gemini-1.5-pro', 'Gemini 1.5 Pro', 2097152, true, false]
      ]
    },
    {
      id: 'xai', name: 'xAI', kind: 'openai',
      base: 'https://api.x.ai/v1', keyHint: 'xai-…',
      models: [
        ['grok-4', 'Grok 4', 256000, true, true],
        ['grok-3', 'Grok 3', 131072, true, false],
        ['grok-3-mini', 'Grok 3 mini', 131072, false, true],
        ['grok-3-fast', 'Grok 3 Fast', 131072, true, false],
        ['grok-3-mini-fast', 'Grok 3 mini Fast', 131072, false, true],
        ['grok-2-vision-1212', 'Grok 2 Vision', 32768, true, false]
      ]
    },
    {
      id: 'mistral', name: 'Mistral', kind: 'openai',
      base: 'https://api.mistral.ai/v1', keyHint: '…',
      models: [
        ['mistral-large-latest', 'Mistral Large', 128000, false, false],
        ['mistral-medium-latest', 'Mistral Medium', 128000, false, false],
        ['mistral-small-latest', 'Mistral Small', 32000, false, false],
        ['codestral-latest', 'Codestral', 256000, false, false],
        ['devstral-small-latest', 'Devstral Small', 128000, false, true],
        ['magistral-medium-latest', 'Magistral Medium', 40000, true, true]
      ]
    },
    {
      id: 'deepseek', name: 'DeepSeek', kind: 'openai',
      base: 'https://api.deepseek.com/v1', keyHint: 'sk-…',
      models: [
        ['deepseek-chat', 'DeepSeek V3', 131072, false, false],
        ['deepseek-reasoner', 'DeepSeek R1', 131072, false, true],
        ['deepseek-coder', 'DeepSeek Coder', 163840, false, false],
        ['deepseek-v3', 'DeepSeek V3 (alias)', 131072, false, false],
        ['deepseek-r1', 'DeepSeek R1 (alias)', 131072, false, true],
        ['deepseek-prover-v2', 'DeepSeek Prover V2', 131072, false, true]
      ]
    },
    {
      id: 'ollama', name: 'Ollama', kind: 'openai',
      base: 'http://localhost:11434/v1', keyHint: 'optional',
      models: [
        ['qwen3:8b', 'Qwen 3 8B', 32768, false, true],
        ['llama3.3:70b', 'Llama 3.3 70B', 131072, false, false],
        ['gemma3:27b', 'Gemma 3 27B', 131072, true, false],
        ['mistral-small', 'Mistral Small', 32768, false, false],
        ['deepseek-r1:14b', 'DeepSeek R1 14B', 131072, false, true],
        ['qwen2.5-coder:32b', 'Qwen 2.5 Coder 32B', 32768, false, false]
      ]
    },
    {
      id: 'openrouter', name: 'OpenRouter', kind: 'openai',
      base: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…',
      models: [
        ['openai/gpt-4.1', 'OpenAI / GPT-4.1', 1047576, true, false],
        ['anthropic/claude-sonnet-4', 'Anthropic / Claude Sonnet 4', 200000, true, true],
        ['google/gemini-2.5-pro', 'Google / Gemini 2.5 Pro', 1048576, true, true],
        ['deepseek/deepseek-r1', 'DeepSeek / R1', 163840, false, true],
        ['qwen/qwen3-235b-a22b', 'Qwen 3 235B', 40960, false, true],
        ['mistralai/devstral-small', 'Mistral / Devstral Small', 131072, false, true]
      ]
    }
  ];

  const flatModels = [];
  providers.forEach(function (provider) {
    provider.models = provider.models.map(function (m) {
      const model = {
        id: m[0], name: m[1], context: m[2], vision: !!m[3],
        reasoning: !!m[4], provider: provider.id, providerName: provider.name
      };
      flatModels.push(model);
      return model;
    });
  });

  const catalogue = {
    version: 1,
    providers: providers,
    models: flatModels,
    getProvider: function (id) {
      return providers.find(function (p) { return p.id === id; }) || null;
    },
    getModel: function (id) {
      return flatModels.find(function (m) { return m.id === id; }) || null;
    },
    modelsFor: function (providerId) {
      const p = this.getProvider(providerId);
      return p ? p.models.slice() : [];
    }
  };

  // Export several descriptive aliases so older/newer app.js variants can use
  // the same file without a bundler or module loader.
  root.AI_PROVIDERS = providers;
  root.MODEL_CATALOGUE = catalogue;
  root.MODEL_CATALOG = catalogue;
  root.modelCatalogue = catalogue;
  root.getModelCatalogue = function () { return catalogue; };
})(window);
