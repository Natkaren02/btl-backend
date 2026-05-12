// jobs.js — in-memory job queue for async Pinterest analysis
// Jobs run in background, frontend polls for completion

import { analyseBoard } from '../lib/vision.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// In-memory job store (survives for the life of the process)
const jobs = new Map();

export function createJob(jobId) {
  jobs.set(jobId, {
    id: jobId,
    status: 'pending', // pending | running | done | failed
    progress: 0,
    message: 'Starting analysis...',
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

// Run analysis in background — no await, fire and forget
export async function runAnalysisJob(jobId, pins, sessionKey) {
  updateJob(jobId, { status: 'running', message: 'Reading your pins...' });

  try {
    const pinsWithImages = pins.filter(p => p.image);
    const total = pinsWithImages.length;
    
    updateJob(jobId, { 
      message: `Analysing ${total} pins...`,
      progress: 5 
    });

    // Analyse in batches of 5, updating progress as we go
    const batchSize = 5;
    const allAnalyses = [];

    for (let i = 0; i < pinsWithImages.length; i += batchSize) {
      const batch = pinsWithImages.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(pin => 
          import('../lib/vision.js').then(m => m.analyseImage(pin.image))
            .then(analysis => ({ analysis, imageUrl: pin.image }))
        )
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value?.analysis) {
          allAnalyses.push(r.value);
        }
      }

      const done = Math.min(i + batchSize, total);
      const progress = Math.round((done / total) * 85) + 5;
      const messages = [
        'Identifying silhouettes...',
        'Analysing colours and materials...',
        'Finding patterns in your style...',
        'Building your style profile...',
        'Almost there...',
      ];
      const msgIdx = Math.floor((i / total) * messages.length);
      
      updateJob(jobId, { 
        progress,
        message: `${messages[msgIdx] || 'Analysing...'} (${done}/${total} pins)`,
      });
    }

    if (allAnalyses.length === 0) {
      updateJob(jobId, { status: 'failed', error: 'Could not analyse any images' });
      return;
    }

    // Build aggregated results
    updateJob(jobId, { progress: 90, message: 'Building your style report...' });

    const allItems = allAnalyses.flatMap(({ analysis, imageUrl }) =>
      (analysis.items || []).map(item => ({ ...item, pin_image: imageUrl }))
    );
    const allSearchTerms = allAnalyses.flatMap(({ analysis }) => analysis.search_terms || []);
    const allVibes = allAnalyses.map(({ analysis }) => analysis.overall_vibe).filter(Boolean);

    const countBy = (arr, key) => {
      const counts = {};
      for (const item of arr) {
        const val = item[key];
        if (val && val !== 'n/a' && val !== 'N/A') counts[val] = (counts[val] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    };

    const byCategory = {};
    for (const item of allItems) {
      const key = item.subcategory || item.category || 'other';
      if (!byCategory[key]) byCategory[key] = [];
      byCategory[key].push(item);
    }

    const categoryBreakdown = Object.entries(byCategory)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([name, items]) => ({
        name,
        count: items.length,
        colours: countBy(items, 'colour'),
        fits: countBy(items, 'fit'),
        rises: countBy(items, 'rise').filter(r => r.value),
        materials: countBy(items, 'material'),
        details: countBy(items, 'details').filter(d => d.value),
        items,
        images: [...new Set(items.map(i => i.pin_image).filter(Boolean))].slice(0, 4),
      }));

    const dominantColours = countBy(allItems, 'colour').slice(0, 5).map(c => c.value);
    const dominantMaterials = countBy(allItems, 'material').slice(0, 4).map(m => m.value);
    const uniqueTerms = [...new Set(allSearchTerms)].slice(0, 12);

    const summaryParts = [];
    if (dominantColours.length) summaryParts.push(dominantColours.slice(0, 2).join(' and '));
    if (dominantMaterials.length) summaryParts.push(dominantMaterials.slice(0, 2).join(' and '));
    if (allVibes.length) summaryParts.push(allVibes[0]);

    // Search for matching products
    updateJob(jobId, { progress: 95, message: 'Finding matching products...' });
    
    let products = [];
    try {
      const { data } = await supabase
        .from('products')
        .select('*, brand:brands(name, verified)')
        .eq('available', true)
        .order('sustainability_score', { ascending: false })
        .limit(24);
      products = data || [];
    } catch {}

    const analysis = {
      summary: summaryParts.join(', ') || 'Your personal style',
      style_vibe: allVibes[0] || 'minimal',
      dominant_colours: dominantColours,
      dominant_materials: dominantMaterials,
      category_breakdown: categoryBreakdown,
      search_terms: uniqueTerms,
      items: allItems,
      pins_analysed: allAnalyses.length,
    };

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      message: 'Analysis complete',
      result: { analysis, products, search_terms: uniqueTerms },
    });

    console.log(`Job ${jobId} complete: ${allAnalyses.length} pins, ${allItems.length} items`);

  } catch (err) {
    console.error(`Job ${jobId} failed:`, err.message);
    updateJob(jobId, { status: 'failed', error: err.message });
  }
}
