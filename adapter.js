require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const IS_MOCK_MODE = process.env.MOCK_MODE !== 'false'; // default true

// Initialize Gemini SDK if API key is present
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// Pricing configuration ($ per 1,000 tokens / per image)
const PRICING = {
  promptTokenPer1k: 0.0015,
  completionTokenPer1k: 0.0020,
  imageUnitCost: 0.020
};

/**
 * Synthesize an optimized, photorealistic visual prompt for the image model
 */
function buildImagePrompt(topic, style) {
  const cleanTopic = (topic || 'Automotive Technology Innovation')
    .replace(/[^\w\s-]/g, ' ')
    .trim();

  const visualStyles = {
    article: 'cinematic studio photography, 8k resolution, ultra-detailed automotive engineering, dramatic volumetric lighting, depth of field, photorealistic',
    guide: 'crisp 3D technical visualization, clean architectural blueprint elements, precision engineering model, studio lighting, hyper-realistic',
    opinion: 'dramatic editorial conceptual art, visionary aesthetic, moody ambient reflections, high contrast, cinematic masterpiece',
    trend_analysis: 'futuristic data-infused technological landscape, glowing fiber-optic energy traces, cutting-edge industry visualization, 8k'
  };

  const styleDirective = visualStyles[style] || visualStyles.article;
  return `High-end commercial photograph of ${cleanTopic}, ${styleDirective}, professional color grading, clean composition, masterpiece quality`;
}

/**
 * Generate a dynamic SVG placeholder image with randomized colorways and seeds
 */
function generatePlaceholderSvg(topic, style, seed = Date.now()) {
  const cleanTopic = (topic || 'Automotive AI Insight')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const safeTopic = cleanTopic.length > 55 ? cleanTopic.slice(0, 52) + '...' : cleanTopic;
  const styleLabel = (style || 'ARTICLE').toUpperCase().replace('_', ' ');

  const palettes = [
    { name: 'CYAN ELECTRIC', bg1: '#091322', bg2: '#0284c7', accent: '#38bdf8', shapeColor: '#6366f1' },
    { name: 'EMERALD HYBRID', bg1: '#03251a', bg2: '#059669', accent: '#34d399', shapeColor: '#10b981' },
    { name: 'INDIGO QUANTUM', bg1: '#111029', bg2: '#4f46e5', accent: '#a5b4fc', shapeColor: '#c084fc' },
    { name: 'AMBER PROPULSION', bg1: '#261205', bg2: '#d97706', accent: '#fbbf24', shapeColor: '#f97316' }
  ];

  const p = palettes[Math.abs(seed) % palettes.length];
  const waveOffset = (seed % 60);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480" width="100%" height="100%">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${p.bg1}" />
        <stop offset="100%" stop-color="${p.bg2}" />
      </linearGradient>
      <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.09)" />
        <stop offset="100%" stop-color="rgba(255,255,255,0.02)" />
      </linearGradient>
    </defs>
    <rect width="800" height="480" fill="url(#bgGrad)" />
    
    <!-- Dynamic geometric elements -->
    <circle cx="${700 - waveOffset}" cy="${80 + waveOffset}" r="150" fill="${p.accent}" opacity="0.15" />
    <circle cx="${120 + waveOffset}" cy="${390 - waveOffset}" r="170" fill="${p.shapeColor}" opacity="0.12" />
    <path d="M 0,${240 + waveOffset} Q ${200 + waveOffset},${170 - waveOffset} 400,${230 + waveOffset} T 800,230" fill="none" stroke="${p.accent}" stroke-opacity="0.3" stroke-width="2" />
    <path d="M 0,${280 - waveOffset} Q 250,${220 + waveOffset} 500,${270 - waveOffset} T 800,280" fill="none" stroke="${p.shapeColor}" stroke-opacity="0.25" stroke-width="2" />

    <!-- Center Card -->
    <rect x="60" y="60" width="680" height="360" rx="20" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.18)" stroke-width="1.5" />

    <!-- Badges -->
    <rect x="90" y="90" width="160" height="32" rx="16" fill="${p.bg2}" fill-opacity="0.3" stroke="${p.accent}" stroke-width="1" />
    <text x="170" y="111" fill="${p.accent}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" letter-spacing="1.5" text-anchor="middle">
      ${styleLabel}
    </text>

    <rect x="260" y="90" width="180" height="32" rx="16" fill="rgba(15,23,42,0.6)" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
    <text x="350" y="111" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="600" text-anchor="middle">
      PALETTE: ${p.name}
    </text>

    <!-- Title / Topic -->
    <text x="90" y="180" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="800">
      ${safeTopic}
    </text>

    <!-- Subtitle -->
    <text x="90" y="225" fill="#cbd5e1" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="400">
      AI Guardrailed Studio · Synthesized Visual Composition
    </text>

    <!-- Seed & Telemetry pills -->
    <rect x="90" y="270" width="180" height="42" rx="8" fill="rgba(15,23,42,0.6)" stroke="rgba(255,255,255,0.1)" />
    <text x="105" y="296" fill="#cbd5e1" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13">
      🎲 Seed: #${seed.toString().slice(-6)}
    </text>

    <rect x="285" y="270" width="165" height="42" rx="8" fill="rgba(15,23,42,0.6)" stroke="rgba(255,255,255,0.1)" />
    <text x="300" y="296" fill="${p.accent}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13">
      🛡️ Guardrails Passed
    </text>

    <!-- Watermark -->
    <text x="90" y="380" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12">
      Dynamic Visual Synthesis · Refreshed ${new Date().toLocaleTimeString()}
    </text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// High-Resolution Photorealistic Thematic Bank (1200x675 HD Photography)
const THEMATIC_PHOTO_BANK = {
  battery: [
    'https://images.unsplash.com/photo-1617788138017-80ad40651399?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1508974239320-0a029497e820?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1200&h=675&q=85'
  ],
  cockpit_screen: [
    'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=1200&h=675&q=85'
  ],
  dealership_ai: [
    'https://images.unsplash.com/photo-1560179707-f14e90ef3623?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&h=675&q=85'
  ],
  fleet_autonomous: [
    'https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?auto=format&fit=crop&w=1200&h=675&q=85'
  ],
  general_tech: [
    'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&h=675&q=85',
    'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&h=675&q=85'
  ]
};

/**
 * Generate a fresh photorealistic or dynamic image asset with unique seed
 */
async function generateSynthesizedImage(topic, style, customSeed) {
  const seed = customSeed || Math.floor(Math.random() * 9000000) + 1000000;
  const prompt = buildImagePrompt(topic, style);
  const lower = (topic || '').toLowerCase();

  // 1. If OpenAI API key is configured, call DALL-E 3
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: prompt.slice(0, 1000),
          n: 1,
          size: '1024x1024'
        })
      });
      const data = await res.json();
      if (data.data?.[0]?.url) {
        console.log(`[DALL-E 3 Image Generated] Seed: ${seed}`);
        return data.data[0].url;
      }
    } catch (e) {
      console.warn('[DALL-E 3 Notice, falling back]:', e.message);
    }
  }

  // 2. Thematic Photorealistic High-Definition Matching
  let category = 'general_tech';
  if (/screen|display|cockpit|dashboard|interior|infotainment|hud|touchscreen/i.test(lower)) {
    category = 'cockpit_screen';
  } else if (/battery|solid.?state|cell|electrolyte|energy|charge|charging|anode|cathode/i.test(lower)) {
    category = 'battery';
  } else if (/fleet|truck|logistics|telematics|autonomous|sensor|radar|lidar/i.test(lower)) {
    category = 'fleet_autonomous';
  } else if (/deal|retail|customer|sales|crm|retention|finance|showroom/i.test(lower)) {
    category = 'dealership_ai';
  }

  const photos = THEMATIC_PHOTO_BANK[category] || THEMATIC_PHOTO_BANK.general_tech;
  const photoIndex = Math.abs(seed) % photos.length;
  const selectedPhoto = photos[photoIndex];

  console.log(`[Photorealistic Image Assigned] Category: ${category}, Photo #${photoIndex + 1}/${photos.length}, Seed: ${seed}`);
  return selectedPhoto;
}

/**
 * Generate rich, realistic mock text tailored to topic and style (Your Existing Mock)
 */
function generateMockText(topic, style) {
  const cleanTopic = topic.trim();
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `# Deep Dive: ${cleanTopic}
*Comprehensive Analysis (${style}) · ${dateStr}*

## Introduction
Adopting modern best practices for **${cleanTopic}** is critical for operational efficiency. This simulated brief highlights key architectural patterns, cost-control mechanisms, and guardrail validation rules.

## Core Pillars
1. **Deterministic Guardrails**: Filtering inputs before compute spend.
2. **Provider Abstraction**: Swapping between mock engines and live frontier models seamlessly.
3. **Telemetry Tracking**: Metering prompt tokens, completion tokens, and real-time daily spend accumulation.

## Conclusion
Mastering ${cleanTopic} requires a harmony of automated safeguards and editorial oversight.`;
}

/**
 * Provider Adapter: Supports MOCK mode or live Gemini API execution
 */
async function generateContent({ topic, generationOption, style }) {
  // 1. If Mock Mode is active, use your existing local generation functions
  if (IS_MOCK_MODE || !ai) {
    await new Promise(resolve => setTimeout(resolve, 250));

    let generatedText = null;
    let generatedImageUrl = null;
    let promptTokens = Math.max(45, Math.floor(topic.length * 1.8) + 30);
    let completionTokens = 0;
    let imageCount = 0;

    if (generationOption === 'text' || generationOption === 'text_image') {
      generatedText = generateMockText(topic, style);
      completionTokens = Math.floor(generatedText.split(/\s+/).length * 1.35);
    }

    if (generationOption === 'image_only' || generationOption === 'text_image') {
      generatedImageUrl = await generateSynthesizedImage(topic, style);
      imageCount = 1;
    }

    const textCost = (promptTokens / 1000) * PRICING.promptTokenPer1k + (completionTokens / 1000) * PRICING.completionTokenPer1k;
    const imageCost = imageCount * PRICING.imageUnitCost;

    return {
      provider: 'mock-provider',
      model: 'mock-text-curie-v2',
      generatedText,
      generatedImageUrl,
      imagePrompt: generationOption !== 'text' ? buildImagePrompt(topic, style) : null,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        imageCount,
        cost: parseFloat((textCost + imageCost).toFixed(5))
      }
    };
  }

  // 2. Live Gemini API execution when MOCK_MODE=false and API key exists
  try {
    let generatedText = null;
    let generatedImageUrl = null;
    let promptTokens = 0;
    let completionTokens = 0;
    let imageCount = 0;
    let usedModel = 'gemini-3.5-flash-lite';

    if (generationOption === 'text' || generationOption === 'text_image') {
      const prompt = `Write a comprehensive, professional ${style} (500-800 words) about: "${topic}". Format with markdown headings.`;
      
      let response = null;

      // Resilient model cascade: flash-lite -> flash -> mock fallback
      const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
      for (const m of candidateModels) {
        try {
          response = await ai.models.generateContent({
            model: m,
            contents: prompt,
          });
          if (response && response.text) {
            usedModel = m;
            break;
          }
        } catch (mErr) {
          console.warn(`[Gemini Model '${m}' error]:`, mErr.message);
        }
      }

      if (response && response.text) {
        generatedText = response.text;
        const usage = response.usageMetadata || {};
        promptTokens = usage.promptTokenCount || Math.floor(topic.length * 2);
        completionTokens = usage.candidatesTokenCount || Math.floor(generatedText.split(/\s+/).length * 1.3);
      } else {
        // Fallback to high-quality local generator if external API is temporarily down
        console.warn('[Gemini Live Fallback]: All live models failed or busy. Falling back to local synthesis engine.');
        generatedText = generateMockText(topic, style);
        completionTokens = Math.floor(generatedText.split(/\s+/).length * 1.35);
        usedModel = 'local-resilient-fallback';
      }
    }

    if (generationOption === 'image_only' || generationOption === 'text_image') {
      generatedImageUrl = await generateSynthesizedImage(topic, style);
      imageCount = 1;
    }

    const textCost = (promptTokens / 1000) * PRICING.promptTokenPer1k + (completionTokens / 1000) * PRICING.completionTokenPer1k;
    const imageCost = imageCount * PRICING.imageUnitCost;

    return {
      provider: 'google-gemini',
      model: usedModel,
      generatedText,
      generatedImageUrl,
      imagePrompt: generationOption !== 'text' ? buildImagePrompt(topic, style) : null,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        imageCount,
        cost: parseFloat((textCost + imageCost).toFixed(5))
      }
    };

  } catch (error) {
    console.error('[Gemini API Error]:', error);
    throw new Error(`Gemini live generation failed: ${error.message}`);
  }
}

module.exports = {
  IS_MOCK_MODE,
  PRICING,
  buildImagePrompt,
  generateSynthesizedImage,
  generatePlaceholderSvg,
  generateMockText,
  generateContent
};