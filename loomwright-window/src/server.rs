//! A tiny loopback server: static assets plus the three JSON endpoints the
//! web application expects (`/api/app-status`, `/api/sync`, `/api/git/*`).

use crate::assets::{mime, WEB};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

struct Store {
    revision: u64,
    record: Option<serde_json::Value>,
    path: PathBuf,
}

pub struct Server {
    pub port: u16,
    #[allow(dead_code)]
    store: Arc<Mutex<Store>>,
}

impl Server {
    pub fn start() -> std::io::Result<Self> {
        let (listener, port) = bind()?;
        let path = data_dir().join("shared.json");

        // On a fresh install the file does not exist yet. Write an explicit
        // empty seed so the web layer never inherits demo or stale data from a
        // previous installation that happened to live in the same APPDATA path.
        let fresh_install = !path.exists();

        let mut store = Store {
            revision: 0,
            record: None,
            path,
        };
        if !fresh_install {
            if let Ok(raw) = fs::read_to_string(&store.path) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                    store.revision = value.get("revision").and_then(|v| v.as_u64()).unwrap_or(0);
                    // Strip any record that still carries demo content: the
                    // sentinel project id "p-demo" is used by the test/dummy
                    // data set.  If it is the only project (or is the active
                    // project), discard the whole record so the user begins
                    // with a clean slate.
                    let candidate = value.get("record").cloned();
                    store.record = candidate.and_then(|rec| purge_demo_data(rec));
                }
            }
        }

        // Persist whatever we landed on (empty or cleaned) immediately so the
        // revision counter is always on disk from first launch.
        {
            let snapshot = serde_json::json!({
                "revision": store.revision,
                "record":   store.record,
            });
            let _ = fs::write(&store.path, snapshot.to_string());
        }

        let store = Arc::new(Mutex::new(store));
        let shared = store.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let store = shared.clone();
                        std::thread::spawn(move || {
                            let _ = handle(stream, store);
                        });
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self { port, store })
    }
}

fn bind() -> std::io::Result<(TcpListener, u16)> {
    // A fixed port keeps the origin (and therefore localStorage) stable
    // between launches.
    TcpListener::bind(("127.0.0.1", 47832)).map(|l| (l, 47832))
}

pub fn data_dir() -> PathBuf {
    let root = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Loomwright");
    let _ = fs::create_dir_all(&root);
    root
}

fn handle(mut stream: TcpStream, store: Arc<Mutex<Store>>) -> std::io::Result<()> {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end;
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = find_headers_end(&buffer) {
            header_end = position;
            break;
        }
        if buffer.len() > 64 * 1024 {
            return Ok(());
        }
    }

    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let target = parts.next().unwrap_or("/").to_string();

    let mut content_length = 0usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }

    let path = target.split(['?', '#']).next().unwrap_or("/").to_string();
    let path = percent_decode(&path);

    let (status, content_type, payload) = route(&method, &path, &body, &store);
    let response_head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream.write_all(response_head.as_bytes())?;
    stream.write_all(&payload)?;
    stream.flush()?;
    Ok(())
}

fn route(
    method: &str,
    path: &str,
    body: &[u8],
    store: &Arc<Mutex<Store>>,
) -> (String, String, Vec<u8>) {
    match (method, path) {
        ("GET", "/api/app-status") => (
            "200 OK".into(),
            "application/json".into(),
            br#"{"name":"loomwright","version":"3.0.0"}"#.to_vec(),
        ),
        ("GET", "/api/git/status") => (
            "200 OK".into(),
            "application/json".into(),
            br#"{"branch":"main","commit":"installed","message":"Desktop build","summary":"","dirty":false,"operation":{"running":false,"action":null,"step":null,"startedAt":null,"finishedAt":null,"ok":null,"output":"","error":""}}"#.to_vec(),
        ),
        ("POST", "/api/git/sync") | ("POST", "/api/git/pull") | ("POST", "/api/git/push") => (
            "409 Conflict".into(),
            "application/json".into(),
            br#"{"error":"Loomwright updates are delivered through the installer."}"#.to_vec(),
        ),
        ("GET", "/api/sync") => {
            let store = store.lock().unwrap();
            let value = serde_json::json!({
                "revision": store.revision,
                "record": store.record,
            });
            ("200 OK".into(), "application/json".into(), value.to_string().into_bytes())
        }
        ("PUT", "/api/sync") => match serde_json::from_slice::<serde_json::Value>(body) {
            Ok(value) => {
                let expected = value
                    .get("expectedRevision")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(u64::MAX);
                let mut store = store.lock().unwrap();
                if expected != store.revision {
                    let value = serde_json::json!({
                        "revision": store.revision,
                        "record": store.record,
                    });
                    return ("409 Conflict".into(), "application/json".into(), value.to_string().into_bytes());
                }
                let record = value.get("record").cloned().unwrap_or(serde_json::Value::Null);
                store.revision += 1;
                store.record = Some(record);
                let snapshot = serde_json::json!({
                    "revision": store.revision,
                    "record": store.record,
                });
                let _ = fs::write(&store.path, snapshot.to_string());
                let _ = fs::write(
                    store.path.with_extension("json.bak"),
                    snapshot.to_string(),
                );
                ("200 OK".into(), "application/json".into(), snapshot.to_string().into_bytes())
            }
            Err(_) => (
                "400 Bad Request".into(),
                "application/json".into(),
                br#"{"error":"Invalid project record."}"#.to_vec(),
            ),
        },
        _ => {
            let relative = path.trim_start_matches('/');
            let relative = if relative.is_empty() { "index.html" } else { relative };
            if let Some(file) = WEB.get_file(relative) {
                return ("200 OK".into(), mime(relative).into(), file.contents().to_vec());
            }
            // Single-page navigation: unknown paths fall back to the shell.
            if !relative.contains('.') {
                if let Some(index) = WEB.get_file("index.html") {
                    return ("200 OK".into(), "text/html; charset=utf-8".into(), index.contents().to_vec());
                }
            }
            ("404 Not Found".into(), "text/plain".into(), b"Not found".to_vec())
        }
    }
}

/// Remove any demo / test projects from a shared-sync record and return
/// `None` when the record becomes empty (so the web layer starts fresh).
///
/// The bundled demo project was stored under the sentinel id `"p-demo"`.
/// Any install that ran while that data was present in `shared.json` will
/// carry it forward on upgrade; this function ensures it is never surfaced
/// to real users.
fn purge_demo_data(mut record: serde_json::Value) -> Option<serde_json::Value> {
    const DEMO_IDS: &[&str] = &["p-demo"];

    if let Some(projects) = record.get_mut("projects").and_then(|v| v.as_array_mut()) {
        projects.retain(|project| {
            let id = project.get("id").and_then(|v| v.as_str()).unwrap_or("");
            !DEMO_IDS.contains(&id)
        });
    }

    // If the active project was one of the demo sentinels, clear it so the
    // web layer falls back to the first real project (or creates a new one).
    let active_is_demo = record
        .get("activeProjectId")
        .and_then(|v| v.as_str())
        .map_or(false, |id| DEMO_IDS.contains(&id));
    if active_is_demo {
        if let Some(obj) = record.as_object_mut() {
            obj.remove("activeProjectId");
        }
    }

    // Return None when there is nothing left — the web layer will create a
    // brand-new blank project on its own.
    let is_empty = record
        .get("projects")
        .and_then(|v| v.as_array())
        .map_or(true, |arr| arr.is_empty());

    if is_empty { None } else { Some(record) }
}

fn find_headers_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n").map(|position| position + 4)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}
