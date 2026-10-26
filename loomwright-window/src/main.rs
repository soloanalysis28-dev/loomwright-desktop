// Loomwright — native Windows shell for the original Loomwright interface.
//
// The window hosts WebView2 (the same Chromium engine the app was designed
// for), so every screen, transition and animation renders exactly as it does
// in the browser. Rust owns the process: the window, the loopback asset/API
// server, the profile location and the installer integration.

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod assets;
mod server;

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::{Icon, WindowBuilder},
};

fn main() {
    let server = match server::Server::start() {
        Ok(server) => server,
        Err(error) => {
            eprintln!("Loomwright could not start its local service: {error}");
            return;
        }
    };

    let url = format!("http://127.0.0.1:{}/index.html", server.port);

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Loomwright")
        .with_inner_size(LogicalSize::new(1320.0, 880.0))
        .with_min_inner_size(LogicalSize::new(980.0, 640.0))
        .with_window_icon(window_icon())
        .build(&event_loop)
        .expect("could not create the Loomwright window");

    let profile = profile_dir();
    let mut context = wry::WebContext::new(Some(profile));

    // The caption is painted by DWM in the app's own background colour and the
    // title text is set to the same colour, so only the window buttons remain.
    let hwnd = {
        #[cfg(windows)]
        {
            use tao::platform::windows::WindowExtWindows;
            window.hwnd() as isize
        }
        #[cfg(not(windows))]
        {
            let _ = &window;
            0
        }
    };
    #[cfg(windows)]
    {
        titlebar::strip_caption_icon(hwnd);
        titlebar::paint(hwnd, "#fbfcfa");
    }

    let webview = match wry::WebViewBuilder::new_with_web_context(&mut context)
        .with_url(url)
        .with_initialization_script(TITLEBAR_SCRIPT)
        .with_ipc_handler(move |request: wry::http::Request<String>| {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(request.body()) {
                if let Some(bg) = value.get("bg").and_then(|value| value.as_str()) {
                    titlebar::paint(hwnd, bg);
                }
            }
        })
        .with_devtools(cfg!(debug_assertions))
        .build(&window)
    {
        Ok(webview) => webview,
        Err(error) => {
            // The WebView2 runtime is what renders the interface; without it
            // the window would stay blank. Explain and offer the download.
            fatal(
                "Loomwright needs the Microsoft WebView2 runtime.\n\n\
                 It is installed with Microsoft Edge on Windows 10 and 11, but it \
                 is missing on this machine.\n\n\
                 Open the download page now?",
                &format!("{error}"),
            );
            return;
        }
    };


    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent { event, .. } = event {
            if matches!(event, WindowEvent::CloseRequested) {
                *control_flow = ControlFlow::Exit;
            }
        }
        let _ = &webview;
    });
}

/// Reports the app's live `--bg` colour to the shell whenever the theme or
/// palette changes, so the caption always matches the page.
const TITLEBAR_SCRIPT: &str = r#"
(() => {
  const push = () => {
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg && window.ipc) window.ipc.postMessage(JSON.stringify({ bg }));
    } catch (error) {}
  };
  const start = () => {
    push();
    new MutationObserver(push).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-palette']
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
"#;

#[cfg(windows)]
mod titlebar {
    use windows_sys::Win32::Foundation::{HWND, WPARAM};
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIcon, SendMessageW, ICON_SMALL, WM_SETICON};

    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;

    /// Replace the caption icon with a fully transparent one. The large icon
    /// stays untouched, so the taskbar and Alt+Tab still show Loomwright.
    pub fn strip_caption_icon(hwnd: isize) {
        // 16x16 at 1bpp: AND mask all ones, XOR all zeroes -> nothing drawn.
        const AND_MASK: [u8; 32] = [0xff; 32];
        const XOR_MASK: [u8; 32] = [0x00; 32];
        unsafe {
            let module = GetModuleHandleW(std::ptr::null());
            let icon = CreateIcon(
                module,
                16,
                16,
                1,
                1,
                AND_MASK.as_ptr(),
                XOR_MASK.as_ptr(),
            );
            if !icon.is_null() {
                SendMessageW(hwnd as HWND, WM_SETICON, ICON_SMALL as WPARAM, icon as isize);
            } else {
                SendMessageW(hwnd as HWND, WM_SETICON, ICON_SMALL as WPARAM, 0);
            }
        }
    }

    /// Paint the caption in `#rrggbb`, hide the title text, and choose glyph
    /// colouring that matches a light or dark surface.
    pub fn paint(hwnd: isize, hex: &str) {
        let (r, g, b) = parse(hex);
        // COLORREF is 0x00BBGGRR.
        let color = (b as u32) << 16 | (g as u32) << 8 | r as u32;
        let luminance = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;
        let dark: i32 =
            if luminance < 128.0 {
                1
            } else {
                0
            };
        unsafe {
            DwmSetWindowAttribute(
                hwnd as HWND,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
                &dark as *const _ as *const _,
                4,
            );
            for attribute in [DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_BORDER_COLOR] {
                DwmSetWindowAttribute(
                    hwnd as HWND,
                    attribute,
                    &color as *const _ as *const _,
                    4,
                );
            }
        }
    }

    fn parse(hex: &str) -> (u8, u8, u8) {
        let value = hex.trim().trim_start_matches('#');
        if value.len() == 6 {
            if let (Ok(r), Ok(g), Ok(b)) = (
                u8::from_str_radix(&value[0..2], 16),
                u8::from_str_radix(&value[2..4], 16),
                u8::from_str_radix(&value[4..6], 16),
            ) {
                return (r, g, b);
            }
        }
        (0xfb, 0xfc, 0xfa)
    }
}

/// `%LOCALAPPDATA%\Loomwright\WebView2` — keeps the app's localStorage,
/// IndexedDB and service-worker data in one predictable place.
fn profile_dir() -> std::path::PathBuf {
    let root = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Loomwright")
        .join("WebView2");
    let _ = std::fs::create_dir_all(&root);
    root
}

/// The real app icon (the same PNG the web manifest uses) for the title bar,
/// taskbar and Alt+Tab.
fn window_icon() -> Option<Icon> {
    let bytes = include_bytes!("../web/app-icon-512.png");
    let image = image::load_from_memory(bytes).ok()?.to_rgba8();
    let resized = image::imageops::resize(&image, 64, 64, image::imageops::FilterType::Lanczos3);
    Icon::from_rgba(resized.into_raw(), 64, 64).ok()
}

/// Show a blocking error with an optional trip to the WebView2 download page.
#[cfg(windows)]
fn fatal(message: &str, detail: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_YESNO};

    let wide = |value: &str| -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    };
    let body = wide(&format!("{message}\n\nDetails: {detail}"));
    let title = wide("Loomwright");
    let answer = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            title.as_ptr(),
            MB_ICONERROR | MB_YESNO,
        )
    };
    if answer == IDYES {
        let _ = std::process::Command::new("cmd")
            .args([
                "/C",
                "start",
                "",
                "https://developer.microsoft.com/microsoft-edge/webview2/",
            ])
            .spawn();
    }
}

#[cfg(not(windows))]
fn fatal(message: &str, detail: &str) {
    eprintln!("{message}\n{detail}");
}