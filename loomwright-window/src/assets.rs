//! Embedded copy of the Loomwright web application.

use include_dir::{include_dir, Dir};

pub static WEB: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/web");

pub fn mime(path: &str) -> &'static str {
    let extension = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "pfb" => "application/octet-stream",
        "bcmap" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}
