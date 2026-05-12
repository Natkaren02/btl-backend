// jobs.js — async job queue for Pinterest analysis
import { analyseImage, generateFormulaImage } from './vision.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const jobs = new Map();

export function createJob(jobId, type = 'board') {
  jobs.set(jobId, { id: jobId, type, status: 'pending', progress: 0, message: 'Starting...', result: null, error: null });
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (job) jobs.set(jobId, { ...job, ...updates });
}

const countBy = (arr, key) => {
  const counts = {};
  for (const item of arr) {
    const val = item[key];
    if (val && val !== 'n/a' && val !== 'N/A') counts[val] = (counts[val] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
};

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
      pins: [formulas[i].pin_image].filter(Boolean),
      count: 1,
      items: formulas[i].items,
    };
    const keyWords = (formulas[i].formula || '').toLowerCase().split(/[\s+]+/).filter(w => w.length > 3);
    for (let j = i + 1; j < formulas.length; j++) {
      if (used.has(j)) continue;
      const otherWords = (formulas[j].formula || '').toLowerCase().split(/[\s+]+/).filter(w => w.length > 3);
      if (keyWords.filter(k => otherWords.includes(k)).length >= 2) {
        group.count++;
        if (formulas[j].pin_image) group.pins.push(formulas[j].pin_image);
        used.add(j);
      }
    }
    used.add(i);
    groups.push(group);
  }
  return groups.sort((a, b) => b.count - a.count);
}

export async function runBoardAnalysis(jobId, pins) {
  updateJob(jobId, { status: 'running', message: 'Reading your pins...' });
  try {
    const pinsWithImages = pins.filter(p => p.image);
    const total = pinsWithImages.length;
    updateJob(jobId, { message: `Analysing ${total} pins...`, progress: 5 });

    const batchSize = 8;
    const allAnalyses = [];

    for (let i = 0; i < pinsWithImages.length; i += batchSize) {
      const batch = pinsWithImages.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(pin => analyseImage(pin.image).then(analysis => ({ analysis, pin })))
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.analysis) allAnalyses.push(r.value);
      }
      const done = Math.min(i + batchSize, total);
      updateJob(jobId, { progress: Math.round((done / total) * 70) + 5, message: `Analysed ${done} of ${total} pins...` });
    }

    if (allAnalyses.length === 0) { updateJob(jobId, { status: 'failed', error: 'Could not analyse any images' }); return; }

    updateJob(jobId, { progress: 75, message: 'Identifying outfit formulas...' });

    const allItems = allAnalyses.flatMap(({ analysis, pin }) =>
      (analysis.items || []).map(item => ({ ...item, pin_image: pin.image, pin_id: pin.id }))
    );

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

    const formulaGroups = groupFormulas(formulas);

    updateJob(jobId, { progress: 80, message: 'Generating style visuals...' });

    const dominantColours = countBy(allItems, 'colour').slice(0, 5).map(c => c.value);
    const dominantMaterials = countBy(allItems, 'material').slice(0, 4).map(m => m.value);
    const allVibes = allAnalyses.map(({ analysis }) => analysis.overall_vibe).filter(Boolean);

    for (let i = 0; i < Math.min(3, formulaGroups.length); i++) {
      try {
        const img = await generateFormulaImage(formulaGroups[i].formula, dominantColours.slice(0, 3), formulaGroups[i].vibe || allVibes[0] || 'minimal');
        if (img) formulaGroups[i].generated_image = img;
      } catch {}
    }

    const allSearchTerms = allAnalyses.flatMap(({ analysis }) =>
      (analysis.items || []).map(i => i.search_query).filter(Boolean)
    );

    const summaryParts = [];
    if (dominantColours.length) summaryParts.push(dominantColours.slice(0, 2).join(' and '));
    if (dominantMaterials.length) summaryParts.push(dominantMaterials.slice(0, 2).join(' and '));
    if (allVibes.length) summaryParts.push(allVibes[0]);

    updateJob(jobId, {
      status: 'done', progress: 100, message: 'Analysis complete',
      result: {
        summary: summaryParts.join(', ') || 'Your personal style',
        style_vibe: allVibes[0] || 'minimal',
        dominant_colours: dominantColours,
        dominant_materials: dominantMaterials,
        formula_groups: formulaGroups,
        search_terms: [...new Set(allSearchTerms)].slice(0, 12),
        pins_analysed: allAnalyses.length,
        total_pins: total,
      }
    });
    console.log(`Board analysis done: ${allAnalyses.length}/${total} pins`);
  } catch (err) {
    console.error('Board analysis failed:', err.message);
    updateJob(jobId, { status: 'failed', error: err.message });
  }
}

export async function runPinAnalysis(jobId, imageUrl) {
  updateJob(jobId, { status: 'running', progress: 20, message: 'Examining your pin in detail...' });
  try {
    const analysis = await analyseImage(imageUrl);
    if (!analysis) { updateJob(jobId, { status: 'failed', error: 'Could not analyse image' }); return; }
    updateJob(jobId, { status: 'done', progress: 100, message: 'Done', result: analysis });
    console.log('Pin analysis done:', analysis.overall_vibe);
  } catch (err) {
    console.error('Pin analysis failed:', err.message);
    updateJob(jobId, { status: 'failed', error: err.message });
  }
}
