// jobs.js — async job queue for Pinterest analysis

const jobs = new Map();

export function createJob(jobId, type = 'board') {
  jobs.set(jobId, {
    id: jobId,
    type,
    status: 'pending',
    progress: 0,
    message: 'Starting...',
    result: null,
    error: null,
    created: Date.now(),
  });
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (job) jobs.set(jobId, { ...job, ...updates });
}

// Board analysis — find recurring outfit formulas
export async function runBoardAnalysis(jobId, pins) {
  updateJob(jobId, { status: 'running', message: 'Reading your pins...' });

  try {
    const { analyseImage, generateFormulaImage } = await import('./vision.js');
    const pinsWithImages = pins.filter(p => p.image);
    const total = pinsWithImages.length;

    updateJob(jobId, { message: `Analysing ${total} pins individually...`, progress: 5 });

    // Analyse all pins in batches of 8
    const batchSize = 8;
    const allAnalyses = [];

    for (let i = 0; i < pinsWithImages.length; i += batchSize) {
      const batch = pinsWithImages.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(pin =>
          analyseImage(pin.image).then(analysis => ({ analysis, pin }))
        )
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value?.analysis) {
          allAnalyses.push(r.value);
        }
      }

      const done = Math.min(i + batchSize, total);
      const progress = Math.round((done / total) * 70) + 5;
      updateJob(jobId, {
        progress,
        message: `Analysed ${done} of ${total} pins...`
      });
    }

    if (allAnalyses.length === 0) {
      updateJob(jobId, { status: 'failed', error: 'Could not analyse any images' });
      return;
    }

    updateJob(jobId, { progress: 75, message: 'Identifying outfit formulas...' });

    // Extract all items with their pin images
    const allItems = allAnalyses.flatMap(({ analysis, pin }) =>
      (analysis.items || []).map(item => ({ ...item, pin_image: pin.image, pin_id: pin.id }))
    );

    // Extract outfit formulas
    const formulas = allAnalyses
      .filter(({ analysis }) => analysis.outfit_formula)
      .map(({ analysis, pin }) => ({
        formula: analysis.outfit_formula,
        vibe: analysis.overall_vibe,
        balance: analysis.balance_notes,
        proportions: analysis.proportions,
        pin_image: pin.image,
        items: analysis.items || [],
      }));

    // Group similar formulas
    const formulaGroups = groupFormulas(formulas);

    updateJob(jobId, { progress: 80, message: 'Finding colour patterns...' });

    // Count attributes
    const countBy = (arr, key) => {
      const counts = {};
      for (const item of arr) {
        const val = item[key];
        if (val && val !== 'n/a' && val !== 'N/A') counts[val] = (counts[val] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    };

    const dominantColours = countBy(allItems, 'colour').slice(0, 5).map(c => c.value);
    const dominantMaterials = countBy(allItems, 'material').slice(0, 4).map(m => m.value);
    const allVibes = allAnalyses.map(({ analysis }) => analysis.overall_vibe).filter(Boolean);
    const allSearchTerms = allAnalyses.flatMap(({ analysis }) =>
      (analysis.items || []).map(i => i.search_query).filter(Boolean)
    );

    // Generate DALL-E images for top 3 formulas
    updateJob(jobId, { progress: 85, message: 'Generating style visuals...' });

    for (let i = 0; i < Math.min(3, formulaGroups.length); i++) {
      const fg = formulaGroups[i];
      try {
        const img = await generateFormulaImage(fg.formula, dominantColours.slice(0, 3), fg.vibe || allVibes[0] || 'minimal');
        if (img) formulaGroups[i].generated_image = img;
      } catch {}
    }

    updateJob(jobId, { progress: 95, message: 'Almost done...' });

    const uniqueTerms = [...new Set(allSearchTerms)].slice(0, 12);
    const summaryParts = [];
    if (dominantColours.length) summaryParts.push(dominantColours.slice(0, 2).join(' and '));
    if (dominantMaterials.length) summaryParts.push(dominantMaterials.slice(0, 2).join(' and '));
    if (allVibes.length) summaryParts.push(allVibes[0]);

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      message: 'Analysis complete',
      result: {
        summary: summaryParts.join(', ') || 'Your personal style',
        style_vibe: allVibes[0] || 'minimal',
        dominant_colours: dominantColours,
        dominant_materials: dominantMaterials,
        formula_groups: formulaGroups,
        search_terms: uniqueTerms,
        pins_analysed: allAnalyses.length,
        total_pins: total,
      }
    });

    console.log(`Board analysis done: ${allAnalyses.length}/${total} pins, ${formulaGroups.length} formulas found`);

  } catch (err) {
    console.error(`Board analysis failed:`, err.message);
    updateJob(jobId, { status: 'failed', error: err.message });
  }
}

// Single pin analysis — maximum precision
export async function runPinAnalysis(jobId, imageUrl) {
  updateJob(jobId, { status: 'running', message: 'Analysing your pin in detail...' });

  try {
    const { analyseImage } = await import('./vision.js');
    const analysis = await analyseImage(imageUrl);

    if (!analysis) {
      updateJob(jobId, { status: 'failed', error: 'Could not analyse image' });
      return;
    }

    updateJob(jobId, { status: 'done', progress: 100, message: 'Done', result: analysis });

  } catch (err) {
    updateJob(jobId, { status: 'failed', error: err.message });
  }
}

// Group similar outfit formulas together
function groupFormulas(formulas) {
  if (!formulas.length) return [];

  const groups = [];
  const used = new Set();

  for (let i = 0; i < formulas.length; i++) {
    if (used.has(i)) continue;

    const group = {
      formula: formulas[i].formula,
      vibe: formulas[i].vibe,
      balance: formulas[i].balance,
      proportions: formulas[i].proportions,
      pins: [formulas[i].pin_image],
      count: 1,
      items: formulas[i].items,
    };

    // Find similar formulas (share key words)
    const keyWords = extractKeyWords(formulas[i].formula);
    for (let j = i + 1; j < formulas.length; j++) {
      if (used.has(j)) continue;
      const otherKeyWords = extractKeyWords(formulas[j].formula);
      const shared = keyWords.filter(k => otherKeyWords.includes(k));
      if (shared.length >= 2) {
        group.count++;
        group.pins.push(formulas[j].pin_image);
        used.add(j);
      }
    }

    used.add(i);
    groups.push(group);
  }

  return groups.sort((a, b) => b.count - a.count);
}

function extractKeyWords(formula) {
  if (!formula) return [];
  const stopWords = ['a', 'an', 'the', 'and', '+', 'with', 'or', 'in', 'of'];
  return formula.toLowerCase().split(/[\s+]+/).filter(w => w.length > 3 && !stopWords.includes(w));
}
