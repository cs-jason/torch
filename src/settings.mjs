import path from 'node:path';
import { home, read, atomic, locked, fail } from './storage.mjs';

const settingsFile = () => path.join(home(), 'settings.json');
const validLimit = value => Number.isSafeInteger(value) && value >= 3 && value <= 10;
const savedLimit = value => Number.isSafeInteger(value) ? Math.max(3, Math.min(10, value)) : 3;

export function dashboardSettings() {
  const saved = JSON.parse(read(settingsFile(), '{}'));
  return {
    showHome: saved.dashboard?.showHome !== false,
    showAllProjects: saved.dashboard?.showAllProjects === true,
    uiSounds: saved.dashboard?.uiSounds === true,
    homeReviewLimit: savedLimit(saved.dashboard?.homeReviewLimit),
    homeRecentLimit: savedLimit(saved.dashboard?.homeRecentLimit),
  };
}
export function saveDashboardSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) fail('Choose a dashboard setting.');
  for (const [key, value] of Object.entries(patch)) {
    if (['homeReviewLimit', 'homeRecentLimit'].includes(key)) {
      if (!validLimit(value)) fail('Choose a whole number from 3 to 10.');
    } else if (!['showHome', 'showAllProjects', 'uiSounds'].includes(key) || typeof value !== 'boolean') fail('Choose a valid dashboard setting.');
  }
  return locked(home(), () => {
    const saved = JSON.parse(read(settingsFile(), '{}'));
    const dashboard = { ...saved.dashboard, ...patch };
    atomic(settingsFile(), JSON.stringify({ ...saved, dashboard }, null, 2) + '\n');
    return dashboardSettings();
  });
}
