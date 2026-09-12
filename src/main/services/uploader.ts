import { logger } from '../utils/logger';
import { authStore } from '../utils/authStore';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

interface UploadPayload {
  timeLogId: number;
  imgBuffer: Buffer;
  capturedAt: string;
  keyboardActivity: number;
  mouseActivity: number;
  activeWindowTitle: string;
}

/**
 * Uploads a screenshot to the backend via multipart/form-data POST.
 */
export async function uploadScreenshot(payload: UploadPayload): Promise<boolean> {
  const { accessToken } = authStore.getTokens();
  if (!accessToken) {
    logger.warn('Screenshot upload skipped: no access token');
    return false;
  }

  logger.info(`Uploading screenshot for timeLogId=${payload.timeLogId}`);

  try {
    const filename = `screenshot_${Date.now()}.png`;
    const blob = new Blob([new Uint8Array(payload.imgBuffer)], { type: 'image/png' });

    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('capturedAt', payload.capturedAt);
    formData.append('keyboardActivityPercent', String(payload.keyboardActivity));
    formData.append('mouseActivityPercent', String(payload.mouseActivity));
    formData.append('activeWindowTitle', payload.activeWindowTitle);

    let response = await fetch(
      `${API_BASE}/screenshots/upload/${payload.timeLogId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      },
    );

    if (response.status === 401 || response.status === 403) {
      try {
        logger.info('Access token expired, refreshing session for screenshot upload...');
        const newAccessToken = await authStore.refreshSession();
        response = await fetch(
          `${API_BASE}/screenshots/upload/${payload.timeLogId}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${newAccessToken}`,
            },
            body: formData,
          },
        );
      } catch (refreshErr) {
        logger.error('Failed to refresh token during screenshot upload', refreshErr);
      }
    }

    if (response.ok) {
      const data = await response.json();
      logger.info(`Screenshot uploaded: screenshotId=${data?.data?.screenshotId}`);
      return true;
    } else {
      logger.warn(`Screenshot upload failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    logger.error('Screenshot upload error', error);
    return false;
  }
}
