use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

static SYNC_STOP: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
static SYNC_INCOMING: OnceLock<Mutex<Option<SyncIncoming>>> = OnceLock::new();

#[derive(Clone, Serialize)]
struct SyncHostInfo {
    address: String,
    token: String,
    expires_at: u64,
}

#[derive(Clone, Serialize)]
struct SyncIncoming {
    payload: String,
    secret: String,
}

struct SyncSession {
    package: String,
    pairing_token: String,
    session_token: Mutex<Option<String>>,
    pairing_consumed: AtomicBool,
}

fn sync_stop_state() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    SYNC_STOP.get_or_init(|| Mutex::new(None))
}

fn sync_incoming_state() -> &'static Mutex<Option<SyncIncoming>> {
    SYNC_INCOMING.get_or_init(|| Mutex::new(None))
}

fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("8.8.8.8:80")?;
            socket.local_addr()
        })
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn http_response(status: &str, content_type: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    )
}

fn read_http_request(stream: &mut TcpStream) -> Option<(String, Vec<u8>)> {
    let mut buffer = Vec::with_capacity(16 * 1024);
    let mut chunk = [0_u8; 8192];
    let header_end;
    let content_length;
    loop {
        let size = stream.read(&mut chunk).ok()?;
        if size == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..size]);
        if let Some(position) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            header_end = position + 4;
            let headers = String::from_utf8_lossy(&buffer[..position]);
            content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    if name.eq_ignore_ascii_case("Content-Length") {
                        value.trim().parse::<usize>().ok()
                    } else {
                        None
                    }
                })
                .unwrap_or(0);
            break;
        }
        if buffer.len() > 1024 * 1024 {
            return None;
        }
    }
    while buffer.len() < header_end + content_length {
        let size = stream.read(&mut chunk).ok()?;
        if size == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..size]);
    }
    let headers = String::from_utf8_lossy(&buffer[..header_end - 4]).to_string();
    let body = buffer[header_end..header_end + content_length].to_vec();
    Some((headers, body))
}

fn bearer_token(headers: &str) -> Option<String> {
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case("Authorization") {
            value.trim().strip_prefix("Bearer ").map(str::to_string)
        } else {
            None
        }
    })
}

fn new_session_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!("session-{nanos:x}-{}", std::process::id())
}

fn handle_sync_connection(mut stream: TcpStream, session: &SyncSession) {
    let Some((headers, body)) = read_http_request(&mut stream) else {
        return;
    };
    let mut request_parts = headers
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let path = request_parts.next().unwrap_or_default();
    if method == "OPTIONS" {
        let _ = stream.write_all(http_response("204 No Content", "text/plain", "").as_bytes());
        return;
    }
    let provided_token = bearer_token(&headers).unwrap_or_default();
    if path != "/dunots-sync" {
        let _ = stream.write_all(
            http_response(
                "404 Not Found",
                "application/json",
                r#"{"error":"not found"}"#,
            )
            .as_bytes(),
        );
        return;
    }
    if method == "GET"
        && provided_token == session.pairing_token
        && !session.pairing_consumed.swap(true, Ordering::AcqRel)
    {
        let session_token = new_session_token();
        if let Ok(mut current) = session.session_token.lock() {
            *current = Some(session_token.clone());
        }
        let body = format!(
            r#"{{"package":{},"sessionToken":"{}"}}"#,
            session.package, session_token
        );
        let _ = stream.write_all(http_response("200 OK", "application/json", &body).as_bytes());
        return;
    }
    if method == "POST" {
        let is_session = session
            .session_token
            .lock()
            .map(|mut current| {
                if current.as_deref() == Some(provided_token.as_str()) {
                    *current = None;
                    true
                } else {
                    false
                }
            })
            .unwrap_or(false);
        if is_session {
            if let Ok(payload) = String::from_utf8(body) {
                if let Ok(mut incoming) = sync_incoming_state().lock() {
                    *incoming = Some(SyncIncoming {
                        payload,
                        secret: provided_token,
                    });
                }
                let _ = stream.write_all(
                    http_response("202 Accepted", "application/json", r#"{"accepted":true}"#)
                        .as_bytes(),
                );
                return;
            }
        }
    }
    let _ = stream.write_all(
        http_response(
            "401 Unauthorized",
            "application/json",
            r#"{"error":"invalid or expired pairing token"}"#,
        )
        .as_bytes(),
    );
}

#[tauri::command]
fn start_sync_host(package: String, token: String) -> Result<SyncHostInfo, String> {
    if package.is_empty() || token.trim().is_empty() {
        return Err("Pacote ou token de pareamento vazio.".to_string());
    }
    let listener = TcpListener::bind("0.0.0.0:0")
        .map_err(|error| format!("Não foi possível abrir a porta local: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Não foi possível preparar o servidor: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut current) = sync_stop_state().lock() {
        if let Some(previous) = current.take() {
            previous.store(true, Ordering::Relaxed);
        }
        *current = Some(stop.clone());
    }
    if let Ok(mut incoming) = sync_incoming_state().lock() {
        *incoming = None;
    }
    let session = Arc::new(SyncSession {
        package,
        pairing_token: token.clone(),
        session_token: Mutex::new(None),
        pairing_consumed: AtomicBool::new(false),
    });
    let server_session = session.clone();
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(600);
        while !stop.load(Ordering::Relaxed) && Instant::now() < deadline {
            match listener.accept() {
                Ok((stream, _)) => handle_sync_connection(stream, &server_session),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100))
                }
                Err(_) => break,
            }
        }
        stop.store(true, Ordering::Relaxed);
    });
    let expires_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs()
        + 600;
    Ok(SyncHostInfo {
        address: format!("http://{}:{port}", local_ip()),
        token,
        expires_at,
    })
}

#[tauri::command]
fn save_sync_package(app: tauri::AppHandle, package: String) -> Result<String, String> {
    if package.trim().is_empty() {
        return Err("Pacote de sincronização vazio.".to_string());
    }
    let downloads = app
        .path()
        .download_dir()
        .map_err(|error| format!("Não foi possível localizar a pasta Downloads: {error}"))?;
    fs::create_dir_all(&downloads)
        .map_err(|error| format!("Não foi possível preparar a pasta Downloads: {error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let path = downloads.join(format!("dunots-sync-{timestamp}.dunots"));
    fs::write(&path, package)
        .map_err(|error| format!("Não foi possível salvar o pacote: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn stop_sync_host() {
    if let Ok(mut current) = sync_stop_state().lock() {
        if let Some(stop) = current.take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut incoming) = sync_incoming_state().lock() {
        *incoming = None;
    }
}

#[tauri::command]
fn take_sync_incoming() -> Option<SyncIncoming> {
    sync_incoming_state()
        .lock()
        .ok()
        .and_then(|mut incoming| incoming.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:enterview.db",
                    vec![Migration {
                        version: 1,
                        description: "create generic study records store",
                        sql: "CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, id)); CREATE INDEX IF NOT EXISTS records_collection_updated_idx ON records(collection, updated_at DESC);",
                        kind: MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            start_sync_host,
            stop_sync_host,
            take_sync_incoming,
            save_sync_package
        ])
        .run(tauri::generate_context!())
        .expect("error while running dunots");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_bearer_token_case_insensitively() {
        let headers = "GET /dunots-sync HTTP/1.1\r\nAuthorization: Bearer abc123\r\n";
        assert_eq!(bearer_token(headers).as_deref(), Some("abc123"));
        assert_eq!(bearer_token("Authorization: Basic abc123"), None);
    }

    #[test]
    fn pairing_consumption_is_one_shot() {
        let session = SyncSession {
            package: "{}".to_string(),
            pairing_token: "pairing".to_string(),
            session_token: Mutex::new(Some("session".to_string())),
            pairing_consumed: AtomicBool::new(false),
        };

        assert!(!session.pairing_consumed.swap(true, Ordering::AcqRel));
        assert!(session.pairing_consumed.swap(true, Ordering::AcqRel));
        assert_eq!(
            session.session_token.lock().unwrap().as_deref(),
            Some("session")
        );
    }

    #[test]
    fn generated_session_tokens_are_not_equal() {
        assert_ne!(new_session_token(), new_session_token());
    }
}
