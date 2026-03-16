//! Push notification support for presence changes.
//!
//! Sends Expo push notifications when the estimated person count changes,
//! with a 30-second cooldown between notifications.

use std::time::Instant;
use tracing::{info, warn};

/// Holds push-notification state: registered tokens, cooldown tracking, and HTTP client.
pub struct NotificationState {
    pub push_tokens: Vec<String>,
    pub previous_person_count: usize,
    pub last_notification_time: Option<Instant>,
    pub enabled: bool,
    pub http_client: reqwest::Client,
}

impl NotificationState {
    pub fn new() -> Self {
        Self {
            push_tokens: Vec::new(),
            previous_person_count: 0,
            last_notification_time: None,
            enabled: true,
            http_client: reqwest::Client::new(),
        }
    }
}

/// Format a human-readable notification message for a presence change.
pub fn format_presence_message(previous: usize, current: usize) -> (String, String) {
    if previous == 0 && current > 0 {
        (
            "Presence Detected".to_string(),
            format!("{current} person(s) detected in the room"),
        )
    } else if current == 0 {
        (
            "Room Empty".to_string(),
            "No presence detected".to_string(),
        )
    } else {
        (
            "Person Count Changed".to_string(),
            format!("Person count: {previous} → {current}"),
        )
    }
}

/// Check whether the person count changed and, if so, dispatch push notifications
/// (fire-and-forget) to all registered Expo push tokens.
pub async fn check_and_notify(
    state: &mut NotificationState,
    current_count: usize,
    motion_level: &str,
) {
    if !state.enabled || state.push_tokens.is_empty() {
        return;
    }

    if current_count == state.previous_person_count {
        return;
    }

    // Enforce 30-second cooldown
    if let Some(last) = state.last_notification_time {
        if last.elapsed().as_secs() < 30 {
            return;
        }
    }

    let previous = state.previous_person_count;
    state.previous_person_count = current_count;
    state.last_notification_time = Some(Instant::now());

    let (title, body) = format_presence_message(previous, current_count);
    let tokens = state.push_tokens.clone();
    let client = state.http_client.clone();
    let motion = motion_level.to_string();
    let count = current_count;

    info!(
        "Dispatching push notification to {} token(s): {title}",
        tokens.len()
    );

    tokio::spawn(async move {
        let messages: Vec<serde_json::Value> = tokens
            .iter()
            .map(|token| {
                serde_json::json!({
                    "to": token,
                    "title": title,
                    "body": body,
                    "sound": "default",
                    "data": {
                        "personCount": count,
                        "motionLevel": motion,
                    }
                })
            })
            .collect();

        match client
            .post("https://exp.host/--/api/v2/push/send")
            .json(&messages)
            .send()
            .await
        {
            Ok(resp) => {
                info!("Expo push response: {}", resp.status());
            }
            Err(e) => {
                warn!("Failed to send push notification: {e}");
            }
        }
    });
}
