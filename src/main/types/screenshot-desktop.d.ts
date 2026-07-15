declare module 'screenshot-desktop' {
  interface ScreenshotOptions {
    format?: 'png' | 'jpg' | 'jpeg';
    screen?: string;
  }

  function screenshot(options?: ScreenshotOptions): Promise<Buffer>;

  export default screenshot;
}
