//! Screenshots (docs/ARCHITECTURE.md section 7): all monitors stitched side by side, longest edge ≤ 1920 px,
//! JPEG quality 70, optional pixelation; taken at a random moment inside each interval.

use std::time::{Duration, Instant};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{GenericImage, RgbImage, RgbaImage};

pub const MAX_EDGE: u32 = 1920;
pub const JPEG_QUALITY: u8 = 70;
pub const PIXELATE_FACTOR: u32 = 16;

/// Random capture moment inside consecutive intervals anchored at the tracking start.
#[derive(Debug, Clone)]
pub struct ScreenshotSchedule {
    interval: Duration,
    window_start: Instant,
    fire_at: Instant,
    fired: bool,
}

impl ScreenshotSchedule {
    /// `offset_fraction` in `[0, 1)` picks the moment inside the first window (random in production).
    pub fn new(interval: Duration, start: Instant, offset_fraction: f64) -> Self {
        let interval = interval.max(Duration::from_secs(10));
        Self { interval, window_start: start, fire_at: start + interval.mul_f64(offset_fraction.clamp(0.0, 0.999)), fired: false }
    }

    pub fn interval(&self) -> Duration {
        self.interval
    }

    pub fn fire_at(&self) -> Instant {
        self.fire_at
    }

    /// Advance windows that ended before `now`; `next_fraction` supplies the random offset for each new one.
    fn roll(&mut self, now: Instant, next_fraction: &mut dyn FnMut() -> f64) {
        while now >= self.window_start + self.interval {
            self.window_start += self.interval;
            self.fire_at = self.window_start + self.interval.mul_f64(next_fraction().clamp(0.0, 0.999));
            self.fired = false;
        }
    }

    /// `true` once per window, when `now` passes that window's moment. Windows missed entirely (sleep,
    /// pause) are skipped rather than fired in a burst.
    pub fn due(&mut self, now: Instant, next_fraction: &mut dyn FnMut() -> f64) -> bool {
        self.roll(now, next_fraction);
        if !self.fired && now >= self.fire_at {
            self.fired = true;
            return true;
        }
        false
    }

    /// Mark the current window as used without capturing (capture paused at its moment).
    pub fn skip_current(&mut self, now: Instant, next_fraction: &mut dyn FnMut() -> f64) {
        self.roll(now, next_fraction);
        if now >= self.fire_at {
            self.fired = true;
        }
    }

    /// Change the interval (settings changed), restarting from `now`.
    pub fn reset(&mut self, interval: Duration, now: Instant, fraction: f64) {
        *self = Self::new(interval, now, fraction);
    }
}

/// Stitch images left to right on a black canvas (tallest height).
pub fn stitch(images: &[RgbaImage]) -> Option<RgbImage> {
    if images.is_empty() {
        return None;
    }
    let width: u32 = images.iter().map(|i| i.width()).sum();
    let height = images.iter().map(|i| i.height()).max().unwrap_or(0);
    if width == 0 || height == 0 {
        return None;
    }
    let mut canvas = RgbImage::new(width, height);
    let mut x = 0;
    for img in images {
        let rgb = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
        canvas.copy_from(&rgb, x, 0).ok()?;
        x += img.width();
    }
    Some(canvas)
}

/// Fit so the longest edge is ≤ `max_edge` (never upscales).
pub fn fit(img: RgbImage, max_edge: u32) -> RgbImage {
    let (w, h) = img.dimensions();
    let longest = w.max(h);
    if longest <= max_edge {
        return img;
    }
    let scale = max_edge as f64 / longest as f64;
    let nw = ((w as f64 * scale).round() as u32).max(1);
    let nh = ((h as f64 * scale).round() as u32).max(1);
    image::imageops::resize(&img, nw, nh, FilterType::Triangle)
}

/// Downscale ×`factor` then upscale back with nearest-neighbour: unreadable blocks.
pub fn pixelate(img: &RgbImage, factor: u32) -> RgbImage {
    let (w, h) = img.dimensions();
    let sw = (w / factor).max(1);
    let sh = (h / factor).max(1);
    let small = image::imageops::resize(img, sw, sh, FilterType::Triangle);
    image::imageops::resize(&small, w, h, FilterType::Nearest)
}

pub fn encode_jpeg(img: &RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality).encode_image(img).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Full pipeline from raw monitor captures to the upload JPEG.
pub fn process(images: &[RgbaImage], blur: bool) -> Result<Vec<u8>, String> {
    let stitched = stitch(images).ok_or("no monitor image")?;
    let mut img = fit(stitched, MAX_EDGE);
    if blur {
        img = pixelate(&img, PIXELATE_FACTOR);
    }
    encode_jpeg(&img, JPEG_QUALITY)
}

/// Capture every monitor, ordered left to right. Blocking: call via `spawn_blocking`.
pub fn capture_all() -> Result<Vec<RgbaImage>, String> {
    let mut monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    monitors.sort_by_key(|m| (m.x().unwrap_or(0), m.y().unwrap_or(0)));
    let mut images = Vec::new();
    let mut last_err = None;
    for m in monitors {
        match m.capture_image() {
            Ok(img) => images.push(img),
            Err(e) => last_err = Some(e.to_string()),
        }
    }
    if images.is_empty() {
        return Err(last_err.unwrap_or_else(|| "no monitors found".to_string()));
    }
    Ok(images)
}

/// Capture + process in one blocking call.
pub fn capture_jpeg(blur: bool) -> Result<Vec<u8>, String> {
    process(&capture_all()?, blur)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_fires_once_per_interval_at_offset() {
        let t0 = Instant::now();
        let i = Duration::from_secs(600);
        let mut next = || 0.5;
        let mut s = ScreenshotSchedule::new(i, t0, 0.25);
        assert!(!s.due(t0 + Duration::from_secs(100), &mut next));
        assert!(s.due(t0 + Duration::from_secs(150), &mut next));
        assert!(!s.due(t0 + Duration::from_secs(151), &mut next));
        assert!(!s.due(t0 + Duration::from_secs(599), &mut next));
        // Second window [600, 1200): moment at 600 + 300.
        assert!(!s.due(t0 + Duration::from_secs(800), &mut next));
        assert!(s.due(t0 + Duration::from_secs(900), &mut next));
        assert!(!s.due(t0 + Duration::from_secs(1000), &mut next));
    }

    #[test]
    fn schedule_skips_missed_windows_without_burst() {
        let t0 = Instant::now();
        let mut next = || 0.9;
        let mut s = ScreenshotSchedule::new(Duration::from_secs(60), t0, 0.1);
        // Asleep for 5 windows: one capture at most, in the window we woke up in (if its moment has passed).
        assert!(s.due(t0 + Duration::from_secs(5 * 60 + 58), &mut next));
        assert!(!s.due(t0 + Duration::from_secs(5 * 60 + 59), &mut next));
    }

    #[test]
    fn schedule_moment_is_inside_window() {
        let t0 = Instant::now();
        let i = Duration::from_secs(300);
        let mut seq = [0.0, 0.999_999, 0.42].into_iter().cycle();
        let mut next = || seq.next().unwrap();
        let mut s = ScreenshotSchedule::new(i, t0, 0.0);
        for k in 1..6u32 {
            s.skip_current(t0 + i * k, &mut next);
            let start = t0 + i * k;
            assert!(s.fire_at() >= start && s.fire_at() < start + i);
        }
    }

    #[test]
    fn skip_current_consumes_window() {
        let t0 = Instant::now();
        let mut next = || 0.5;
        let mut s = ScreenshotSchedule::new(Duration::from_secs(100), t0, 0.5);
        s.skip_current(t0 + Duration::from_secs(60), &mut next);
        assert!(!s.due(t0 + Duration::from_secs(70), &mut next));
        assert!(s.due(t0 + Duration::from_secs(150), &mut next));
    }

    #[test]
    fn stitch_fit_pixelate_encode() {
        let a = RgbaImage::from_pixel(2000, 1000, image::Rgba([255, 0, 0, 255]));
        let b = RgbaImage::from_pixel(1000, 1200, image::Rgba([0, 0, 255, 255]));
        let s = stitch(&[a, b]).unwrap();
        assert_eq!(s.dimensions(), (3000, 1200));
        let f = fit(s, MAX_EDGE);
        assert_eq!(f.width(), 1920);
        assert_eq!(f.height(), 768);
        let p = pixelate(&f, PIXELATE_FACTOR);
        assert_eq!(p.dimensions(), f.dimensions());
        let jpeg = encode_jpeg(&p, JPEG_QUALITY).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
        let small = fit(RgbImage::new(100, 50), MAX_EDGE);
        assert_eq!(small.dimensions(), (100, 50));
        assert!(stitch(&[]).is_none());
    }
}
