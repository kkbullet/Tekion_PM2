const { get, all, getDailySpend, getTodayString } = require('./database');

// Configuration constants (with defaults from env)
const CONFIG = {
  DAILY_SPEND_CAP_USD: parseFloat(process.env.DAILY_SPEND_CAP_USD || '5.00'),
  GLOBAL_RPM_LIMIT: parseInt(process.env.GLOBAL_RPM_LIMIT || '30', 10),
  REPEAT_TOPIC_HOURLY_CAP: parseInt(process.env.REPEAT_TOPIC_HOURLY_CAP || '3', 10),
  MIN_TOPIC_LENGTH: 3,
  MAX_TOPIC_LENGTH: 300,
  ESTIMATED_REQUEST_COST: 0.025, // safety margin estimate for text+image
  VALID_GENERATION_OPTIONS: ['text', 'text_image', 'image_only'],
  VALID_STYLES: ['article', 'guide', 'opinion', 'trend_analysis']
};

/**
 * 1. Input Validation Guardrail
 */
function validateInput({ topic, generationOption, style }) {
  if (!topic || typeof topic !== 'string') {
    return { passed: false, step: 'input_validation', reason: 'Topic is required and must be a text string.' };
  }

  const trimmed = topic.trim();
  if (trimmed.length < CONFIG.MIN_TOPIC_LENGTH) {
    return { passed: false, step: 'input_validation', reason: `Topic is too short. Minimum length is ${CONFIG.MIN_TOPIC_LENGTH} characters.` };
  }

  if (trimmed.length > CONFIG.MAX_TOPIC_LENGTH) {
    return { passed: false, step: 'input_validation', reason: `Topic exceeds maximum length of ${CONFIG.MAX_TOPIC_LENGTH} characters.` };
  }

  if (!CONFIG.VALID_GENERATION_OPTIONS.includes(generationOption)) {
    return {
      passed: false,
      step: 'input_validation',
      reason: `Invalid generation option '${generationOption}'. Allowed: ${CONFIG.VALID_GENERATION_OPTIONS.join(', ')}`
    };
  }

  if (!CONFIG.VALID_STYLES.includes(style)) {
    return {
      passed: false,
      step: 'input_validation',
      reason: `Invalid style '${style}'. Allowed: ${CONFIG.VALID_STYLES.join(', ')}`
    };
  }

  return { passed: true, step: 'input_validation' };
}

/**
 * 2. Gibberish & Low Quality Check Guardrail
 */
function checkGibberish(topic) {
  const trimmed = topic.trim();

  // Pattern A: Repeated single character >= 4 times (e.g. "aaaaa", "zzzzz")
  if (/(.)\1{3,}/i.test(trimmed)) {
    return { passed: false, step: 'gibberish_check', reason: 'Topic contains repetitive character spam.' };
  }

  // Pattern B: Long word without spaces >= 30 chars
  const words = trimmed.split(/\s+/);
  if (words.some(w => w.length > 30)) {
    return { passed: false, step: 'gibberish_check', reason: 'Topic contains unusually long unstructured word strings.' };
  }

  // Pattern C: Keyboard mash patterns (e.g., asdfgh, qwerty, zxcvbn)
  const mashPatterns = [/asdfgh/i, /qwerty/i, /zxcvbn/i, /1234567/i, /lkjhgf/i];
  for (const pattern of mashPatterns) {
    if (pattern.test(trimmed) && trimmed.length < 20) {
      return { passed: false, step: 'gibberish_check', reason: 'Topic identified as random keyboard mash pattern.' };
    }
  }

  // Pattern D: Vowel ratio check for Latin characters (must have reasonable vowels if >= 8 chars)
  const lettersOnly = trimmed.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length >= 8) {
    const vowels = lettersOnly.match(/[aeiouyAEIOUY]/g) || [];
    const vowelRatio = vowels.length / lettersOnly.length;
    // Real English/Latin words rarely have vowel ratio < 0.15 unless acronym
    if (vowelRatio < 0.15) {
      return { passed: false, step: 'gibberish_check', reason: 'Topic lacks sufficient phonetic structure (possible random consonants).' };
    }
  }

  return { passed: true, step: 'gibberish_check' };
}

/**
 * 3. Prompt Injection & Jailbreak Check Guardrail
 */
function checkPromptInjection(topic) {
  const injectionSignatures = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
    /disregard\s+(all\s+)?(previous|prior|above)\s+prompts/i,
    /you\s+are\s+now\s+(an?\s+)?(unrestricted|jailbroken|evil|dan|developer mode)/i,
    /system\s*prompt/i,
    /reveal\s+(your\s+)?(instructions|system\s+message|secret)/i,
    /do\s+anything\s+now/i,
    /bypass\s+all\s+(filters|guardrails|safety)/i,
    /\bDAN\s+mode\b/i,
    /format\s+c:\b/i,
    /<script[\s\S]*?>[\s\S]*?<\/script>/i,
    /union\s+select\s+.*\s+from/i,
    /DROP\s+TABLE/i
  ];

  for (const regex of injectionSignatures) {
    if (regex.test(topic)) {
      return {
        passed: false,
        step: 'injection_check',
        reason: 'Security violation: Detected potential prompt injection, adversarial bypass, or instruction override pattern.'
      };
    }
  }

  return { passed: true, step: 'injection_check' };
}

/**
 * 4. Deduplication & Semantic Cache Check Guardrail
 */
async function checkDedupCache({ topic, generationOption, style, forceFresh = false }) {
  if (forceFresh) {
    return { passed: true, step: 'dedup_cache', isCached: false };
  }

  const normalizedTopic = topic.trim().toLowerCase();

  // Look for a successful request in the last 24 hours with exact match
  const sql = `
    SELECT * FROM requests 
    WHERE LOWER(TRIM(topic)) = ? 
      AND generation_option = ? 
      AND style = ?
      AND status IN ('pending_review', 'approved', 'edited')
      AND created_at >= datetime('now', '-1 day')
    ORDER BY created_at DESC 
    LIMIT 1
  `;
  const cached = await get(sql, [normalizedTopic, generationOption, style]);

  // If cached record has the old SVG data URI, don't reuse it—regenerate fresh photorealistic!
  if (cached && !cached.generated_image_url?.startsWith('data:image/svg')) {
    return {
      passed: true,
      step: 'dedup_cache',
      isCached: true,
      cachedRecord: cached
    };
  }

  return { passed: true, step: 'dedup_cache', isCached: false };
}

/**
 * 5. Repeat Topic Cap Guardrail
 */
async function checkRepeatCap(topic) {
  const normalizedTopic = topic.trim().toLowerCase();

  const sql = `
    SELECT COUNT(*) as count FROM requests 
    WHERE LOWER(TRIM(topic)) = ?
      AND created_at >= datetime('now', '-1 hour')
  `;
  const row = await get(sql, [normalizedTopic]);
  const count = row ? row.count : 0;

  if (count >= CONFIG.REPEAT_TOPIC_HOURLY_CAP) {
    return {
      passed: false,
      step: 'repeat_cap',
      reason: `Topic repeat threshold reached: '${topic.slice(0, 30)}...' has been requested ${count} times in the past hour (cap: ${CONFIG.REPEAT_TOPIC_HOURLY_CAP}).`
    };
  }

  return { passed: true, step: 'repeat_cap', count };
}

/**
 * 6. Global Rate Limit Guardrail (Sliding window RPM)
 */
async function checkGlobalRateLimit() {
  const sql = `
    SELECT COUNT(*) as rpm FROM requests 
    WHERE created_at >= datetime('now', '-1 minute')
  `;
  const row = await get(sql);
  const rpm = row ? row.rpm : 0;

  if (rpm >= CONFIG.GLOBAL_RPM_LIMIT) {
    return {
      passed: false,
      step: 'global_rate_limit',
      reason: `Global system throughput limit reached: ${rpm} requests in the last minute (limit: ${CONFIG.GLOBAL_RPM_LIMIT} RPM). Please retry shortly.`
    };
  }

  return { passed: true, step: 'global_rate_limit', rpm };
}

/**
 * 7. Daily Spend Cap Guardrail
 */
async function checkDailySpendCap() {
  const spendInfo = await getDailySpend();
  const currentSpend = spendInfo.total_spend || 0.0;

  if (currentSpend + CONFIG.ESTIMATED_REQUEST_COST > CONFIG.DAILY_SPEND_CAP_USD) {
    return {
      passed: false,
      step: 'daily_spend_cap',
      reason: `Daily budget cap exceeded: Today's spend is $${currentSpend.toFixed(4)}, cap is $${CONFIG.DAILY_SPEND_CAP_USD.toFixed(2)}. Generation halted to prevent overage.`
    };
  }

  return { passed: true, step: 'daily_spend_cap', currentSpend, cap: CONFIG.DAILY_SPEND_CAP_USD };
}

/**
 * 8. Output Checks Configuration & Execution (Post-generation)
 */
function applyOutputChecks({ text, imageUrl, generationOption }) {
  const checks = {
    lengthCheck: true,
    forbiddenWordsCheck: true,
    piiCheck: true,
    formatCheck: true
  };

  if (generationOption !== 'image_only') {
    if (!text || text.trim().length < 50) {
      return {
        passed: false,
        step: 'output_check',
        reason: 'Output failed minimum length requirement (< 50 characters).'
      };
    }

    // PII check: simulated credit cards or fake SSNs
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
    const creditCardPattern = /\b(?:\d{4}-){3}\d{4}\b/;
    if (ssnPattern.test(text) || creditCardPattern.test(text)) {
      return {
        passed: false,
        step: 'output_check',
        reason: 'Output flagged by PII filter: contains sensitive numeric patterns.'
      };
    }

    // Forbidden toxic/profanity regex check
    const forbiddenPattern = /\b(internal leaked api key|confidential trade secret|hate speech placeholder)\b/i;
    if (forbiddenPattern.test(text)) {
      return {
        passed: false,
        step: 'output_check',
        reason: 'Output violates policy standards against confidential data or toxic content.'
      };
    }
  }

  if (generationOption !== 'text') {
    if (!imageUrl || (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:image'))) {
      return {
        passed: false,
        step: 'output_check',
        reason: 'Output failed image check: Invalid image URL generated.'
      };
    }
  }

  return { passed: true, step: 'output_check', checks };
}

/**
 * Sequential runner for the 8 Guardrails
 */
async function runPreGenerationGuardrails({ topic, generationOption, style, forceFresh = false }) {
  const stepsEvaluated = [];

  // Step 1: Input Validation
  const r1 = validateInput({ topic, generationOption, style });
  stepsEvaluated.push({ name: 'input_validation', passed: r1.passed, details: r1.reason });
  if (!r1.passed) return { passed: false, ...r1, stepsEvaluated };

  // Step 2: Gibberish Check
  const r2 = checkGibberish(topic);
  stepsEvaluated.push({ name: 'gibberish_check', passed: r2.passed, details: r2.reason });
  if (!r2.passed) return { passed: false, ...r2, stepsEvaluated };

  // Step 3: Prompt Injection Check
  const r3 = checkPromptInjection(topic);
  stepsEvaluated.push({ name: 'injection_check', passed: r3.passed, details: r3.reason });
  if (!r3.passed) return { passed: false, ...r3, stepsEvaluated };

  // Step 4: Dedup / Semantic Cache Check
  const r4 = await checkDedupCache({ topic, generationOption, style, forceFresh });
  stepsEvaluated.push({
    name: 'dedup_cache',
    passed: true,
    isCached: r4.isCached,
    details: r4.isCached ? 'Cache Hit: Reusing existing verified generation' : 'Cache Miss: Proceeding to generation'
  });
  if (r4.isCached) {
    return { passed: true, isCached: true, cachedRecord: r4.cachedRecord, stepsEvaluated };
  }

  // Step 5: Repeat Topic Cap
  const r5 = await checkRepeatCap(topic);
  stepsEvaluated.push({ name: 'repeat_cap', passed: r5.passed, details: r5.reason || `Recent count: ${r5.count}` });
  if (!r5.passed) return { passed: false, ...r5, stepsEvaluated };

  // Step 6: Global Rate Limit
  const r6 = await checkGlobalRateLimit();
  stepsEvaluated.push({ name: 'global_rate_limit', passed: r6.passed, details: r6.reason || `Current RPM: ${r6.rpm}` });
  if (!r6.passed) return { passed: false, ...r6, stepsEvaluated };

  // Step 7: Daily Spend Cap
  const r7 = await checkDailySpendCap();
  stepsEvaluated.push({
    name: 'daily_spend_cap',
    passed: r7.passed,
    details: r7.reason || `Current Spend: $${r7.currentSpend.toFixed(4)} / $${r7.cap.toFixed(2)}`
  });
  if (!r7.passed) return { passed: false, ...r7, stepsEvaluated };

  // Guardrail 8 is post-generation output check, so pre-generation phase is all passed
  return {
    passed: true,
    isCached: false,
    step: 'pre_generation_passed',
    stepsEvaluated
  };
}

module.exports = {
  CONFIG,
  validateInput,
  checkGibberish,
  checkPromptInjection,
  checkDedupCache,
  checkRepeatCap,
  checkGlobalRateLimit,
  checkDailySpendCap,
  applyOutputChecks,
  runPreGenerationGuardrails
};
