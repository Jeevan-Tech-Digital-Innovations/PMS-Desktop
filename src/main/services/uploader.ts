import * as fs from 'fs';
import { logger } from '../utils/logger';
import { authStore } from '../utils/authStore';

const API_BASE = process.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

interface UploadPayload {
  timeLogId: number;
  filepath: string;
  capturedAt: string;
  keyboardActivity: number;
  mouseActivity: number;
  activeWindowTitle: string;
}

/**
 * Uploads a screenshot to the backend via multipart/form-data POST.
 *
 * NOTE: The PMS API does not currently provide a screenshot upload endpoint.
 * (POST /time-logs/{id}/screenshots does not exist in the backend.)
 * Screenshots are still captured and kept locally, but the upload is skipped
 * to avoid 404 errors.
 * Once the backend adds a screenshot upload endpoint, re-enable the fetch below.
 */
export async function uploadScreenshot(payload: UploadPayload): Promise<boolean> {
  const { accessToken } = authStore.getTokens();
  if (!accessToken) {
    logger.warn('Screenshot upload skipped: no access token');
    return false;
  }

  logger.info(
    `Screenshot captured locally (upload skipped — endpoint not yet implemented in PMS API): ` +
      `${payload.filepath} for timeLogId=${payload.timeLogId}`,
  );

  /* ── Disabled: endpoint does not exist in PMS API ────────────────
  try {
    const fileBuffer = fs.readFileSync(payload.filepath);
    const filename = payload.filepath.split(/[\\/]/).pop() || 'screenshot.png';
    const blob = new Blob([fileBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('capturedAt', payload.capturedAt);
    formData.append('keyboardActivity', String(payload.keyboardActivity));
    formData.append('mouseActivity', String(payload.mouseActivity));
    formData.append('activeWindowTitle', payload.activeWindowTitle);

    const response = await fetch(
      `${API_BASE}/time-logs/${payload.timeLogId}/screenshots`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      },
    );

    if (response.ok) {
      const data = await response.json();
      logger.info(`Screenshot uploaded: screenshotId=${data?.data?.screenshotId}`);

      // Cleanup temp file
      try {
        fs.unlinkSync(payload.filepath);
      } catch {
        logger.warn(`Could not delete temp file: ${payload.filepath}`);
      }

      return true;
    } else {
      logger.warn(`Screenshot upload failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    logger.error('Screenshot upload error', error);
    return false;
  }
  ──────────────────────────────────────────────────────────────── */

  return true;
}
