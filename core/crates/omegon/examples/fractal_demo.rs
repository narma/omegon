//! Fractal rendering demo — compare algorithms and rendering techniques.
//! Run: cargo run --example fractal_demo

use std::io;
use std::time::{Duration, Instant};
use crossterm::{
    ExecutableCommand,
    event::{self, Event, KeyCode, KeyEvent},
    terminal::{self, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph};

fn main() -> io::Result<()> {
    terminal::enable_raw_mode()?;
    io::stdout().execute(EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;

    let start = Instant::now();
    let mut mode = 0u8; // cycle through rendering modes
    let modes = [
        "Mandelbrot half-block",
        "Mandelbrot + glitch chars",
        "Perlin noise flow",
        "Plasma sine",
        "Strange attractor (Clifford)",
        "Lissajous curves",
    ];

    loop {
        let t = start.elapsed().as_secs_f64();

        terminal.draw(|f| {
            let area = f.area();

            // Fill bg
            let bg = Color::Rgb(6, 10, 18);
            let fg = Color::Rgb(196, 216, 228);
            for y in area.top()..area.bottom() {
                for x in area.left()..area.right() {
                    let cell = &mut f.buffer_mut()[(x, y)];
                    cell.set_bg(bg);
                    cell.set_fg(fg);
                }
            }

            // Layout: label at top, render area below, controls at bottom
            let chunks = Layout::vertical([
                Constraint::Length(2),
                Constraint::Min(8),
                Constraint::Length(2),
            ]).split(area);

            // Label
            let label = Paragraph::new(format!(
                " Mode {}/{}: {}  |  t={:.1}s",
                mode + 1, modes.len(), modes[mode as usize], t
            )).style(Style::default().fg(Color::Rgb(42, 180, 200)));
            f.render_widget(label, chunks[0]);

            // Render area — simulate 36×8 dashboard region
            let render_area = Rect {
                x: chunks[1].x + 2,
                y: chunks[1].y,
                width: 36.min(chunks[1].width - 4),
                height: 8.min(chunks[1].height),
            };

            // Border around render area
            let border = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Rgb(32, 72, 96)))
                .title(format!(" {}×{} ", render_area.width, render_area.height));
            let bordered = Rect {
                x: render_area.x - 1,
                y: render_area.y.saturating_sub(1),
                width: render_area.width + 2,
                height: render_area.height + 2,
            };
            f.render_widget(border, bordered);

            // Also show a wider version next to it
            let wide_area = Rect {
                x: bordered.right() + 2,
                y: render_area.y,
                width: 60.min(area.width.saturating_sub(bordered.right() + 4)),
                height: 8.min(chunks[1].height),
            };
            if wide_area.width >= 20 {
                let wide_border = Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Rgb(32, 72, 96)))
                    .title(format!(" {}×{} wide ", wide_area.width, wide_area.height));
                let wide_bordered = Rect {
                    x: wide_area.x - 1,
                    y: wide_area.y.saturating_sub(1),
                    width: wide_area.width + 2,
                    height: wide_area.height + 2,
                };
                f.render_widget(wide_border, wide_bordered);
                render_mode(mode, t, wide_area, f.buffer_mut());
            }

            render_mode(mode, t, render_area, f.buffer_mut());

            // Controls
            let controls = Paragraph::new(" ←/→ switch mode  |  q quit")
                .style(Style::default().fg(Color::Rgb(96, 120, 136)));
            f.render_widget(controls, chunks[2]);
        })?;

        if event::poll(Duration::from_millis(33))? { // ~30fps
            if let Event::Key(KeyEvent { code, .. }) = event::read()? {
                match code {
                    KeyCode::Char('q') | KeyCode::Esc => break,
                    KeyCode::Right => mode = (mode + 1) % modes.len() as u8,
                    KeyCode::Left => mode = (mode + modes.len() as u8 - 1) % modes.len() as u8,
                    _ => {}
                }
            }
        }
    }

    terminal::disable_raw_mode()?;
    io::stdout().execute(LeaveAlternateScreen)?;
    Ok(())
}

fn render_mode(mode: u8, t: f64, area: Rect, buf: &mut Buffer) {
    match mode {
        0 => render_mandelbrot_halfblock(t, area, buf),
        1 => render_mandelbrot_glitch(t, area, buf),
        2 => render_perlin_flow(t, area, buf),
        3 => render_plasma(t, area, buf),
        4 => render_attractor(t, area, buf),
        5 => render_lissajous(t, area, buf),
        _ => {}
    }
}

// ── Shared color helpers ────────────────────────────────────────────────────

fn ocean_color(t: f64) -> Color {
    let t = t.sqrt();
    Color::Rgb(
        (t * 12.0) as u8,
        (t * 36.0 + t * t * 20.0) as u8,
        (t * 50.0 + t * t * 30.0) as u8,
    )
}

fn amber_color(t: f64) -> Color {
    let t = t.sqrt();
    Color::Rgb(
        (t * 65.0 + t * t * 20.0) as u8,
        (t * 30.0 + t * t * 10.0) as u8,
        (t * 8.0) as u8,
    )
}

fn bg_color() -> Color { Color::Rgb(6, 10, 18) }

// ── Mode 0: Mandelbrot half-block (current approach) ────────────────────────

fn render_mandelbrot_halfblock(time: f64, area: Rect, buf: &mut Buffer) {
    let px_w = area.width as usize;
    let px_h = area.height as usize * 2;
    let zoom = 40.0;
    let drift = 0.003 / (zoom / 40.0);
    let cx = -0.745 + (time * 0.03).sin() * drift;
    let cy = 0.186 + (time * 0.03 * 0.7).cos() * drift * 1.3;
    let aspect = px_w as f64 / px_h as f64;
    let vh = 2.5 / zoom;
    let vw = vh * aspect;

    for py in (0..px_h).step_by(2) {
        let row = py / 2;
        if row >= area.height as usize { break; }
        for px in 0..px_w {
            if px >= area.width as usize { break; }
            let top = mandelbrot_iter(px, py, px_w, px_h, vw, vh, cx, cy, 150);
            let bot = mandelbrot_iter(px, py+1, px_w, px_h, vw, vh, cx, cy, 150);
            let tc = iter_color(top, 150);
            let bc = iter_color(bot, 150);
            if let Some(cell) = buf.cell_mut(Position::new(area.x + px as u16, area.y + row as u16)) {
                cell.set_char('▀');
                cell.set_fg(tc);
                cell.set_bg(bc);
            }
        }
    }
}

// ── Mode 1: Mandelbrot + glitch character cycling ───────────────────────────

const DENSITY_CHARS: &[char] = &[' ', '·', ':', '░', '▒', '▓', '█'];
const BLOCK_CHARS: &[char] = &['▀', '▄', '▌', '▐', '▘', '▝', '▖', '▗', '▚', '▞'];

fn render_mandelbrot_glitch(time: f64, area: Rect, buf: &mut Buffer) {
    let px_w = area.width as usize;
    let px_h = area.height as usize * 2;
    let zoom = 40.0;
    let drift = 0.003 / (zoom / 40.0);
    let cx = -0.745 + (time * 0.03).sin() * drift;
    let cy = 0.186 + (time * 0.03 * 0.7).cos() * drift * 1.3;
    let aspect = px_w as f64 / px_h as f64;
    let vh = 2.5 / zoom;
    let vw = vh * aspect;
    let frame = (time * 8.0) as u32; // character cycling speed

    for py in (0..px_h).step_by(2) {
        let row = py / 2;
        if row >= area.height as usize { break; }
        for px in 0..px_w {
            if px >= area.width as usize { break; }
            let top_iter = mandelbrot_iter(px, py, px_w, px_h, vw, vh, cx, cy, 150);
            let bot_iter = mandelbrot_iter(px, py+1, px_w, px_h, vw, vh, cx, cy, 150);

            // Average iteration for character selection
            let avg_t = ((top_iter + bot_iter) as f64 / 2.0) / 150.0;

            // Character from iteration depth — denser = more iterations
            let base_idx = (avg_t * (DENSITY_CHARS.len() - 1) as f64) as usize;
            // Glitch: occasionally swap to a different block char
            let hash = simple_hash(px as u32, py as u32, frame);
            let glitch = (hash % 17) == 0; // ~6% chance per cell per frame
            let ch = if glitch && avg_t > 0.1 {
                BLOCK_CHARS[(hash as usize / 17) % BLOCK_CHARS.len()]
            } else {
                DENSITY_CHARS[base_idx.min(DENSITY_CHARS.len() - 1)]
            };

            let tc = iter_color(top_iter, 150);
            let bc = iter_color(bot_iter, 150);

            if let Some(cell) = buf.cell_mut(Position::new(area.x + px as u16, area.y + row as u16)) {
                cell.set_char(ch);
                cell.set_fg(tc);
                cell.set_bg(if ch == '▀' { bc } else { bg_color() });
            }
        }
    }
}

// ── Mode 2: Perlin noise flow ───────────────────────────────────────────────

fn render_perlin_flow(time: f64, area: Rect, buf: &mut Buffer) {
    let w = area.width as usize;
    let h = area.height as usize * 2;

    for py in (0..h).step_by(2) {
        let row = py / 2;
        if row >= area.height as usize { break; }
        for px in 0..w {
            if px >= area.width as usize { break; }
            let top = perlin_sample(px as f64 / 8.0, py as f64 / 8.0, time * 0.5);
            let bot = perlin_sample(px as f64 / 8.0, (py+1) as f64 / 8.0, time * 0.5);
            let tc = flow_color(top);
            let bc = flow_color(bot);
            if let Some(cell) = buf.cell_mut(Position::new(area.x + px as u16, area.y + row as u16)) {
                cell.set_char('▀');
                cell.set_fg(tc);
                cell.set_bg(bc);
            }
        }
    }
}

fn flow_color(v: f64) -> Color {
    let t = (v * 0.5 + 0.5).clamp(0.0, 1.0); // normalize -1..1 to 0..1
    Color::Rgb(
        (t * 15.0) as u8,
        (t * 40.0 + t * t * 15.0) as u8,
        (t * 55.0 + t * t * 25.0) as u8,
    )
}

// ── Mode 3: Plasma sine interference ────────────────────────────────────────

fn render_plasma(time: f64, area: Rect, buf: &mut Buffer) {
    let w = area.width as usize;
    let h = area.height as usize * 2;

    for py in (0..h).step_by(2) {
        let row = py / 2;
        if row >= area.height as usize { break; }
        for px in 0..w {
            if px >= area.width as usize { break; }
            let top = plasma_sample(px as f64, py as f64, time);
            let bot = plasma_sample(px as f64, (py+1) as f64, time);
            let tc = plasma_color(top);
            let bc = plasma_color(bot);
            if let Some(cell) = buf.cell_mut(Position::new(area.x + px as u16, area.y + row as u16)) {
                cell.set_char('▀');
                cell.set_fg(tc);
                cell.set_bg(bc);
            }
        }
    }
}

fn plasma_sample(x: f64, y: f64, t: f64) -> f64 {
    let v1 = (x / 6.0 + t * 0.3).sin();
    let v2 = ((y / 4.0 + t * 0.2).sin() + (x / 8.0).cos()).sin();
    let v3 = ((x * x + y * y).sqrt() / 6.0 - t * 0.4).sin();
    (v1 + v2 + v3) / 3.0
}

fn plasma_color(v: f64) -> Color {
    let t = (v * 0.5 + 0.5).clamp(0.0, 1.0);
    Color::Rgb(
        (t * 20.0 + (1.0-t) * 5.0) as u8,
        (t * 45.0) as u8,
        (t * 60.0 + (1.0-t) * 10.0) as u8,
    )
}

// ── Mode 4: Clifford strange attractor ──────────────────────────────────────

fn render_attractor(time: f64, area: Rect, buf: &mut Buffer) {
    let w = area.width as usize;
    let h = area.height as usize * 2;
    let mut grid = vec![0u16; w * h];

    // Clifford attractor parameters — slowly evolving
    let a = -1.4 + (time * 0.02).sin() * 0.3;
    let b = 1.6 + (time * 0.015).cos() * 0.2;
    let c = 1.0 + (time * 0.025).sin() * 0.2;
    let d = 0.7 + (time * 0.03).cos() * 0.1;

    let mut x = 0.1_f64;
    let mut y = 0.1_f64;

    // Iterate the attractor
    for _ in 0..8000 {
        let nx = (a * y).sin() + c * (a * x).cos();
        let ny = (b * x).sin() + d * (b * y).cos();
        x = nx;
        y = ny;

        // Map to grid coordinates
        let gx = ((x + 3.0) / 6.0 * w as f64) as usize;
        let gy = ((y + 3.0) / 6.0 * h as f64) as usize;
        if gx < w && gy < h {
            grid[gy * w + gx] = grid[gy * w + gx].saturating_add(1);
        }
    }

    let max_hits = *grid.iter().max().unwrap_or(&1) as f64;

    for py in (0..h).step_by(2) {
        let row = py / 2;
        if row >= area.height as usize { break; }
        for px in 0..w {
            if px >= area.width as usize { break; }
            let top_v = (grid[py * w + px] as f64 / max_hits).min(1.0);
            let bot_v = if py + 1 < h { (grid[(py+1) * w + px] as f64 / max_hits).min(1.0) } else { 0.0 };
            let tc = attractor_color(top_v);
            let bc = attractor_color(bot_v);
            if let Some(cell) = buf.cell_mut(Position::new(area.x + px as u16, area.y + row as u16)) {
                cell.set_char('▀');
                cell.set_fg(tc);
                cell.set_bg(bc);
            }
        }
    }
}

fn attractor_color(v: f64) -> Color {
    if v < 0.01 { return bg_color(); }
    let t = v.sqrt();
    Color::Rgb(
        (t * 50.0 + t * t * 20.0) as u8,
        (t * 30.0) as u8,
        (t * 60.0 + t * t * 15.0) as u8,
    )
}

// ── Mode 5: Lissajous curves ────────────────────────────────────────────────

fn render_lissajous(time: f64, area: Rect, buf: &mut Buffer) {
    let w = area.width as usize;
    let h = area.height as usize * 2;
    let mut grid = vec![0u16; w * h];

    // Multiple overlapping Lissajous figures
    for curve in 0..3 {
        let freq_x = 3.0 + curve as f64 * 0.7;
        let freq_y = 2.0 + curve as f64 * 1.1;
        let phase = time * (0.3 + curve as f64 * 0.1);

        for i in 0..2000 {
            let t = i as f64 / 2000.0 * std::f64::consts::TAU;
            let x = (freq_x * t + phase).sin();
            let y = (freq_y * t).cos();

            let gx = ((x * 0.45 + 0.5) * w as f64) as usize;
            let gy = ((y * 0.45 + 0.5) * h as f64) as usize;
            if gx < w && gy < h {
                grid[gy * w + gx] = grid[gy * w + gx].saturating_add(1);
            }
        }
    }

    let max_hits = *grid.iter().max().unwrap_or(&1).max(&1) as f64;

    for py in (0..h).step_by(2) {
        let row = py / 2;
        if row >= area.height as usize { break; }
        for px in 0..w {
            if px >= area.width as usize { break; }
            let top_v = (grid[py * w + px] as f64 / max_hits).min(1.0);
            let bot_v = if py + 1 < h { (grid[(py+1) * w + px] as f64 / max_hits).min(1.0) } else { 0.0 };
            let tc = lissajous_color(top_v);
            let bc = lissajous_color(bot_v);
            if let Some(cell) = buf.cell_mut(Position::new(area.x + px as u16, area.y + row as u16)) {
                cell.set_char('▀');
                cell.set_fg(tc);
                cell.set_bg(bc);
            }
        }
    }
}

fn lissajous_color(v: f64) -> Color {
    if v < 0.01 { return bg_color(); }
    let t = v.sqrt();
    Color::Rgb(
        (t * 20.0) as u8,
        (t * 55.0 + t * t * 20.0) as u8,
        (t * 40.0 + t * t * 30.0) as u8,
    )
}

// ── Math helpers ────────────────────────────────────────────────────────────

fn mandelbrot_iter(px: usize, py: usize, w: usize, h: usize, vw: f64, vh: f64, cx: f64, cy: f64, max: u32) -> u32 {
    let re = cx + (px as f64 / w as f64 - 0.5) * vw;
    let im = cy + (py as f64 / h as f64 - 0.5) * vh;
    let mut zr = 0.0_f64;
    let mut zi = 0.0_f64;
    for i in 0..max {
        let zr2 = zr * zr;
        let zi2 = zi * zi;
        if zr2 + zi2 > 4.0 { return i; }
        zi = 2.0 * zr * zi + im;
        zr = zr2 - zi2 + re;
    }
    max
}

fn iter_color(iter: u32, max: u32) -> Color {
    if iter >= max { return bg_color(); }
    let t = (iter as f64 / max as f64).sqrt();
    Color::Rgb(
        (t * 12.0) as u8,
        (t * 36.0 + t * t * 20.0) as u8,
        (t * 50.0 + t * t * 30.0) as u8,
    )
}

/// Simple spatial+temporal hash for glitch effect
fn simple_hash(x: u32, y: u32, frame: u32) -> u32 {
    let mut h = x.wrapping_mul(374761393)
        .wrapping_add(y.wrapping_mul(668265263))
        .wrapping_add(frame.wrapping_mul(1013904223));
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    h ^ (h >> 16)
}

/// Simple value noise (not true Perlin, but fast and smooth enough)
fn perlin_sample(x: f64, y: f64, z: f64) -> f64 {
    let v1 = (x * 1.3 + z).sin() * (y * 0.7 + z * 0.5).cos();
    let v2 = ((x + y) * 0.8 - z * 0.3).sin();
    let v3 = (x * 2.1 - z * 0.7).cos() * (y * 1.5 + z * 0.4).sin();
    (v1 + v2 + v3) / 3.0
}
