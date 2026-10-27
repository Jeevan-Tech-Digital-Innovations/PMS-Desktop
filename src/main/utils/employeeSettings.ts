import { authStore } from './authStore';
import { logger } from './logger';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

export interface EmployeeSettings {
  trackAppsUrls?: string; // "Track Apps & URLs both" | "Track Apps only" | "Track URLs only" | "OFF"
  screenshotFrequency?: number;
  blurScreenshots?: boolean;
  trackKeyboard?: boolean;
  trackMouse?: boolean;
}

let cachedSettings: EmployeeSettings | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches employee settings from the API.
 * Results are cached for 5 minutes to avoid hammering the API.
 */
export async function getEmployeeSettings(): Promise<EmployeeSettings | null> {
  const now = Date.now();

  if (cachedSettings && now < cacheExpiresAt) {
    return cachedSettings;
  }

  const { accessToken } = authStore.getTokens();
  if (!accessToken) {
    logger.warn('getEmployeeSettings: no access token, returning defaults');
    return null;
  }

  try {
    const response = await fetch(`${API_BASE}/employee/settings`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn(`getEmployeeSettings: API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    cachedSettings = data as EmployeeSettings;
    cacheExpiresAt = now + CACHE_TTL_MS;
    logger.debug('Employee settings loaded successfully');
    return cachedSettings;
  } catch (err) {
    logger.error('getEmployeeSettings: network error', err);
    return null;
  }
}

/**
 * Clears the cached settings (e.g. after logout).
 */
export function clearEmployeeSettingsCache(): void {
  cachedSettings = null;
  cacheExpiresAt = 0;
}
