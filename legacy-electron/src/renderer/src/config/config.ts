export const config = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1',
  WS_URL: import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws',
  AXIS_API_URL: import.meta.env.VITE_AXIS_API_URL || 'http://localhost:8081/api',
  AXIS_WEB_URL: import.meta.env.VITE_AXIS_WEB_URL || 'http://localhost:3000',
};
