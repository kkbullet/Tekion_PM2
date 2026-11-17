require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { initDb, run, get, all, getDailySpend, recordUsage } = require('./database');
const { runPreGenerationGuardrails, applyOutputChecks } = require('./guardrails');
const { generateContent } = require('./adapter');

const SAMPLE_TOPICS = [
  {
    topic: 'Next-Generation Solid-State EV Battery Chemistries',
    generationOption: 'text_image',
    style: 'article',
    rationale: 'Demonstrates deep technical research, high token throughput, and visual blueprint generation.'
  },
  {
    topic: 'AI-Powered Customer Retention Strategies for Auto Dealerships',
    generationOption: 'text',
    style: 'guide',
    rationale: 'Demonstrates tactical enterprise SaaS workflow and structured implementation roadmap.'
  },
  {
    topic: 'Autonomous Commercial Fleet Telematics & Predictive Maintenance',
    generationOption: 'text_image',
    style: 'trend_analysis',
    rationale: 'Demonstrates industry trend metrics, market drivers, and multi-modal asset synthesis.'
  }
];

async function main() {
  console.log('='.repeat(70));
  console.log('⚡ TEKION PM2 SAMPLE GENERATION RUNNER');
  console.log('Executing 3 Distinct Topic Blueprints through the 8-Stage Guardrail Pipeline');
  console.log('='.repeat(70));

  await initDb();

  for (let i = 0; i < SAMPLE_TOPICS.length; i++) {
    const item = SAMPLE_TOPICS[i];
    console.log(`\n[Topic ${i + 1}/3] "${item.topic}"`);
    console.log(`  Style: ${item.style.toUpperCase()} | Option: ${item.generationOption}`);
    console.log(`  Focus: ${item.rationale}`);

    // 1. Run Pre-Generation Guardrails
    const guardrailResult = await runPreGenerationGuardrails(item);
    if (!guardrailResult.passed) {
      console.log(`  ❌ BLOCKED at step '${guardrailResult.step}': ${guardrailResult.reason}`);
      continue;
    }
    console.log(`  🛡️ Pre-Generation Guardrails: PASSED (${guardrailResult.stepsEvaluated.length} checks verified)`);

    // 2. Generate Content via Provider Adapter
    const requestId = uuidv4();
    const generated = await generateContent(item);
    console.log(`  ⚡ Adapter Output Generated: ${generated.model} (${generated.usage.totalTokens} tokens)`);

    // 3. Post-Generation Output Checks
    const outputCheck = applyOutputChecks({
      text: generated.generatedText,
      imageUrl: generated.generatedImageUrl,
      generationOption: item.generationOption
    });

    if (!outputCheck.passed) {
      console.log(`  ❌ BLOCKED at output check: ${outputCheck.reason}`);
      continue;
    }
    console.log(`  ✅ Output Check: PASSED (length, format, PII scan clear)`);

    // 4. Record Usage & Telemetry in SQLite
    await recordUsage({
      requestId,
      provider: generated.provider,
      model: generated.model,
      promptTokens: generated.usage.promptTokens,
      completionTokens: generated.usage.completionTokens,
      imageCount: generated.usage.imageCount,
      cost: generated.usage.cost
    });

    // 5. Store Request
    await run(
      `INSERT INTO requests (id, topic, generation_option, style, status, guardrail_step, generated_text, generated_image_url, final_text, cost, is_cached)
       VALUES (?, ?, ?, ?, 'pending_review', 'passed', ?, ?, ?, ?, 0)`,
      [
        requestId,
        item.topic,
        item.generationOption,
        item.style,
        generated.generatedText,
        generated.generatedImageUrl,
        generated.generatedText,
        generated.usage.cost
      ]
    );

    console.log(`  💾 Saved to SQLite requests table (ID: ${requestId.slice(0, 8)}...)`);
    console.log(`  💵 Request Cost: $${generated.usage.cost.toFixed(5)}`);
    if (generated.generatedText) {
      const firstLines = generated.generatedText.split('\n').filter(l => l.trim()).slice(0, 2).join(' ');
      console.log(`  📝 Preview: "${firstLines.slice(0, 110)}..."`);
    }
    if (generated.generatedImageUrl) {
      console.log(`  🖼️ Visual Asset: Generated high-res SVG canvas (${generated.generatedImageUrl.length} bytes data-URI)`);
    }
  }

  // Summary Metrics
  console.log('\n' + '='.repeat(70));
  const spend = await getDailySpend();
  console.log('📊 ACCUMULATED TELEMETRY:');
  console.log(`  - Today Total Requests: ${spend.request_count}`);
  console.log(`  - Today Total Spend:    $${spend.total_spend.toFixed(5)} / $${process.env.DAILY_SPEND_CAP_USD || '5.00'}`);
  console.log(`  - Today Total Tokens:   ${spend.tokens_used}`);
  console.log('='.repeat(70));
  console.log('✅ Sample demonstration complete. All requests available in SQLite and UI!');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
