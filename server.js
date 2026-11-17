require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const {
  initDb,
  run,
  get,
  all,
  getDailySpend,
  getTodayString,
  recordUsage,
  incrementDailyBlocked
} = require('./database');

const {
  CONFIG,
  runPreGenerationGuardrails,
  applyOutputChecks
} = require('./guardrails');

const {
  IS_MOCK_MODE,
  generateContent
} = require('./adapter');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------
// 1. Submit Request Endpoint
// ---------------------------------------------------------
app.post('/api/requests', async (req, res) => {
  try {
    const { topic, generationOption = 'text_image', style = 'article', forceFresh = false } = req.body;
    const requestId = uuidv4();

    // Run 1-7 Pre-generation guardrails sequentially
    const guardrailResult = await runPreGenerationGuardrails({ topic, generationOption, style, forceFresh });

    if (!guardrailResult.passed) {
      // Guardrail violation detected
      await run(
        `INSERT INTO requests (id, topic, generation_option, style, status, guardrail_step, blocked_reason, cost, is_cached)
         VALUES (?, ?, ?, ?, 'guardrail_blocked', ?, ?, 0.0, 0)`,
        [requestId, topic || 'Unknown', generationOption, style, guardrailResult.step, guardrailResult.reason]
      );
      await incrementDailyBlocked();

      return res.status(400).json({
        success: false,
        requestId,
        status: 'guardrail_blocked',
        step: guardrailResult.step,
        blockedReason: guardrailResult.reason,
        stepsEvaluated: guardrailResult.stepsEvaluated
      });
    }

    // Check if semantic cache hit occurred (Guardrail 4)
    if (guardrailResult.isCached) {
      const cached = guardrailResult.cachedRecord;
      await run(
        `INSERT INTO requests (id, topic, generation_option, style, status, guardrail_step, generated_text, generated_image_url, final_text, cost, is_cached)
         VALUES (?, ?, ?, ?, 'pending_review', 'dedup_cache', ?, ?, ?, 0.0, 1)`,
        [requestId, topic, generationOption, style, cached.generated_text, cached.generated_image_url, cached.final_text || cached.generated_text]
      );

      const created = await get(`SELECT * FROM requests WHERE id = ?`, [requestId]);
      return res.status(200).json({
        success: true,
        requestId,
        isCached: true,
        data: created,
        stepsEvaluated: guardrailResult.stepsEvaluated
      });
    }

    // Pass pre-generation checks: Call Adapter (Mock / Live)
    const generated = await generateContent({ topic, generationOption, style });

    // Guardrail 8: Post-generation output checks
    const outputCheck = applyOutputChecks({
      text: generated.generatedText,
      imageUrl: generated.generatedImageUrl,
      generationOption
    });

    if (!outputCheck.passed) {
      await run(
        `INSERT INTO requests (id, topic, generation_option, style, status, guardrail_step, blocked_reason, cost, is_cached)
         VALUES (?, ?, ?, ?, 'guardrail_blocked', 'output_check', ?, 0.0, 0)`,
        [requestId, topic, generationOption, style, outputCheck.reason]
      );
      await incrementDailyBlocked();

      return res.status(422).json({
        success: false,
        requestId,
        status: 'guardrail_blocked',
        step: 'output_check',
        blockedReason: outputCheck.reason,
        stepsEvaluated: [
          ...guardrailResult.stepsEvaluated,
          { name: 'output_check', passed: false, details: outputCheck.reason }
        ]
      });
    }

    // Output check passed: Record usage and persist request
    await recordUsage({
      requestId,
      provider: generated.provider,
      model: generated.model,
      promptTokens: generated.usage.promptTokens,
      completionTokens: generated.usage.completionTokens,
      imageCount: generated.usage.imageCount,
      cost: generated.usage.cost
    });

    await run(
      `INSERT INTO requests (id, topic, generation_option, style, status, guardrail_step, generated_text, generated_image_url, final_text, cost, is_cached, image_prompt)
       VALUES (?, ?, ?, ?, 'pending_review', 'passed', ?, ?, ?, ?, 0, ?)`,
      [
        requestId,
        topic,
        generationOption,
        style,
        generated.generatedText,
        generated.generatedImageUrl,
        generated.generatedText,
        generated.usage.cost,
        generated.imagePrompt || null
      ]
    );

    const savedRequest = await get(`SELECT * FROM requests WHERE id = ?`, [requestId]);

    return res.status(201).json({
      success: true,
      requestId,
      isCached: false,
      data: savedRequest,
      usage: generated.usage,
      stepsEvaluated: [
        ...guardrailResult.stepsEvaluated,
        { name: 'output_check', passed: true, details: 'All safety, length, and PII filters verified' }
      ]
    });
  } catch (error) {
    console.error('[POST /api/requests error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------
// 2. Status Polling / Get Request by ID
// ---------------------------------------------------------
app.get('/api/requests/:id', async (req, res) => {
  try {
    const request = await get(`SELECT * FROM requests WHERE id = ?`, [req.params.id]);
    if (!request) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    const usage = await all(`SELECT * FROM usage_log WHERE request_id = ?`, [req.params.id]);
    res.json({ success: true, data: request, usage });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------
// 3. List Recent Requests
// ---------------------------------------------------------
app.get('/api/requests', async (req, res) => {
  try {
    const requests = await all(`SELECT * FROM requests ORDER BY created_at DESC LIMIT 50`);
    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------
// 4. Human-in-the-Loop Review Actions (Approve, Edit, Reject, Regenerate)
// ---------------------------------------------------------
app.post('/api/requests/:id/action', async (req, res) => {
  try {
    const { id } = req.params;
    const { action, editedText, reviewFeedback, regenerateTarget } = req.body;

    const request = await get(`SELECT * FROM requests WHERE id = ?`, [id]);
    if (!request) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    if (action === 'approve') {
      await run(
        `UPDATE requests SET status = 'approved', review_feedback = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [reviewFeedback || 'Approved by reviewer without edits.', id]
      );
    } else if (action === 'edit') {
      const finalText = editedText !== undefined ? editedText : request.final_text;
      await run(
        `UPDATE requests SET status = 'edited', final_text = ?, review_feedback = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [finalText, reviewFeedback || 'Reviewer modified text before approval.', id]
      );
    } else if (action === 'reject') {
      await run(
        `UPDATE requests SET status = 'rejected', review_feedback = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [reviewFeedback || 'Rejected by human reviewer.', id]
      );
    } else if (action === 'regenerate') {
      // Regenerate content
      const regenOption = regenerateTarget || request.generation_option;
      const generated = await generateContent({
        topic: request.topic,
        generationOption: regenOption,
        style: request.style
      });

      // Output checks on regenerated content
      const outputCheck = applyOutputChecks({
        text: generated.generatedText || request.generated_text,
        imageUrl: generated.generatedImageUrl || request.generated_image_url,
        generationOption: regenOption
      });

      if (!outputCheck.passed) {
        return res.status(422).json({ success: false, error: outputCheck.reason });
      }

      await recordUsage({
        requestId: id,
        provider: generated.provider,
        model: generated.model,
        promptTokens: generated.usage.promptTokens,
        completionTokens: generated.usage.completionTokens,
        imageCount: generated.usage.imageCount,
        cost: generated.usage.cost
      });

      let newText = request.generated_text;
      let newFinalText = request.final_text || request.generated_text;
      let newImage = request.generated_image_url;

      if (regenOption === 'text' || regenOption === 'text_image') {
        newText = generated.generatedText || request.generated_text;
        newFinalText = newText;
      }
      if (regenOption === 'image_only' || regenOption === 'text_image') {
        newImage = generated.generatedImageUrl || request.generated_image_url;
      }

      const totalCost = (request.cost || 0) + generated.usage.cost;

      const newImagePrompt = (regenOption === 'image_only' || regenOption === 'text_image')
        ? (generated.imagePrompt || request.image_prompt)
        : request.image_prompt;

      await run(
        `UPDATE requests SET 
          status = 'pending_review',
          generated_text = ?,
          final_text = ?,
          generated_image_url = ?,
          image_prompt = ?,
          cost = ?,
          review_feedback = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          newText,
          newFinalText,
          newImage,
          newImagePrompt,
          totalCost,
          reviewFeedback || `Regenerated ${regenOption.replace('_', ' ')} asset; awaiting re-evaluation.`,
          id
        ]
      );
    } else {
      return res.status(400).json({ success: false, error: `Invalid action '${action}'. Allowed: approve, edit, reject, regenerate` });
    }

    const updated = await get(`SELECT * FROM requests WHERE id = ?`, [id]);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Action error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------
// 5. System Stats & Spend Telemetry
// ---------------------------------------------------------
app.get('/api/stats', async (req, res) => {
  try {
    const today = getTodayString();
    const spend = await getDailySpend(today);
    const totalRequestsRow = await get(`SELECT COUNT(*) as count FROM requests`);
    const totalApprovedRow = await get(`SELECT COUNT(*) as count FROM requests WHERE status = 'approved' OR status = 'edited'`);
    const totalCachedRow = await get(`SELECT COUNT(*) as count FROM requests WHERE is_cached = 1`);

    res.json({
      success: true,
      date: today,
      mockMode: IS_MOCK_MODE,
      dailySpend: spend.total_spend || 0,
      dailySpendCap: CONFIG.DAILY_SPEND_CAP_USD,
      percentUsed: Math.min(100, (((spend.total_spend || 0) / CONFIG.DAILY_SPEND_CAP_USD) * 100)).toFixed(1),
      dailyRequests: spend.request_count || 0,
      dailyBlocked: spend.blocked_count || 0,
      tokensUsed: spend.tokens_used || 0,
      allTimeRequests: totalRequestsRow ? totalRequestsRow.count : 0,
      allTimeApproved: totalApprovedRow ? totalApprovedRow.count : 0,
      allTimeCached: totalCachedRow ? totalCachedRow.count : 0,
      config: {
        globalRpmLimit: CONFIG.GLOBAL_RPM_LIMIT,
        repeatTopicHourlyCap: CONFIG.REPEAT_TOPIC_HOURLY_CAP
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------
// 6. Mock Sample Batch Demo Endpoint (3 Distinct Topics)
// ---------------------------------------------------------
app.post('/api/mock/sample-batch', async (req, res) => {
  try {
    const sampleTopics = [
      {
        topic: 'Autonomous Fleet Telematics & Predictive Maintenance',
        style: 'article',
        generationOption: 'text_image'
      },
      {
        topic: 'AI-Powered Customer Retention Strategies for Auto Dealerships',
        style: 'guide',
        generationOption: 'text'
      },
      {
        topic: 'Next-Generation Solid-State EV Battery Chemistries',
        style: 'trend_analysis',
        generationOption: 'text_image'
      }
    ];

    const results = [];
    for (const item of sampleTopics) {
      const requestId = uuidv4();
      const generated = await generateContent(item);

      await recordUsage({
        requestId,
        provider: generated.provider,
        model: generated.model,
        promptTokens: generated.usage.promptTokens,
        completionTokens: generated.usage.completionTokens,
        imageCount: generated.usage.imageCount,
        cost: generated.usage.cost
      });

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

      const record = await get(`SELECT * FROM requests WHERE id = ?`, [requestId]);
      results.push(record);
    }

    res.json({
      success: true,
      message: 'Successfully generated 3 distinct sample topic blueprints with full telemetry',
      items: results
    });
  } catch (error) {
    console.error('[Sample batch error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------
// 7. Reset Spend / Testing Helper
// ---------------------------------------------------------
app.post('/api/mock/reset-spend', async (req, res) => {
  try {
    const today = getTodayString();
    await run(`UPDATE daily_spend SET total_spend = 0.0, blocked_count = 0, tokens_used = 0 WHERE date = ?`, [today]);
    res.json({ success: true, message: "Today's spend reset to $0.00 for testing" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Initialize DB and launch server
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`🚀 Tekion PM2 AI Guardrails & HITL App running!`);
      console.log(`📡 URL: http://localhost:${PORT}`);
      console.log(`🛡️ Guardrails: 8-tier sequential evaluation active`);
      console.log(`🎭 Mode: ${IS_MOCK_MODE ? 'MOCK (Zero AI Spend Safe)' : 'LIVE PROVIDER'}`);
      console.log(`💰 Daily Spend Cap: $${CONFIG.DAILY_SPEND_CAP_USD.toFixed(2)}`);
      console.log(`=======================================================`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
