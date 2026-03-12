/**
 * Workers index — worker entry points for workers/ export path
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 */

// Re-export worker file paths for consumers who need to construct Worker instances.
// These are ESM worker scripts — import them using:
//   new Worker(new URL('blast-physics-js/workers/BlairHeavyWorker', import.meta.url), { type: 'module' });
//
// Note: Workers use 'self.postMessage' and are not directly importable as modules.

export const BLAIR_HEAVY_WORKER_URL = new URL("./BlairHeavyWorker.js", import.meta.url);
export const FLYROCK_WORKER_URL = new URL("./FlyrockWorker.js", import.meta.url);
