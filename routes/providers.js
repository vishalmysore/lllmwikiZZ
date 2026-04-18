const express = require('express');
const router = express.Router();

const PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (recommended)' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (fast)' }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyPlaceholder: 'sk-...',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (recommended)' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (fast)' }
    ]
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    keyPlaceholder: 'AIza...',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (recommended)' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
    ]
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    keyPlaceholder: 'nvapi-...',
    models: [
      { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct (recommended)' },
      { id: 'nvidia/nemotron-4-340b-instruct', name: 'Nemotron 4 340B Instruct' }
    ]
  }
];

router.get('/', (req, res) => {
  res.json({ providers: PROVIDERS });
});

module.exports = router;
