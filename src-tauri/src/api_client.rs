use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// PRJ-002 API client for server-side extraction.
/// All requests use X-API-Key header authentication.
/// Clone is cheap: reqwest::Client uses Arc internally.
#[derive(Clone)]
pub struct ApiClient {
    client: Client,
    base_url: String,
    api_key: String,
}

// --- Request/Response types ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractRequest {
    pub template_id: String,
    pub pdf_base64: String,
    pub file_name: String,
    pub save_results: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRequest {
    pub template_id: String,
    pub files: Vec<BatchFile>,
    pub job_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchFile {
    pub pdf_base64: String,
    pub file_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: String,
    pub extraction_type: String,
    pub field_count: u32,
    pub has_table_region: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatesResponse {
    pub templates: Vec<Template>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionResult {
    pub id: String,
    pub file_name: String,
    pub column_name: String,
    pub column_physical_name: String,
    pub raw_value: String,
    pub confidence: f64,
    pub engine: String,
    pub processing_time_ms: u64,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractResponse {
    pub job_id: String,
    pub file_name: String,
    pub template_id: String,
    pub template_name: String,
    pub status: String,
    pub results: Vec<ExtractionResult>,
    pub summary: ExtractSummary,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractSummary {
    pub total_fields: u32,
    pub succeeded_fields: u32,
    pub failed_fields: u32,
    pub processing_time_ms: u64,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResponse {
    pub job_id: String,
    pub status: String,
    pub total_files: u32,
    pub completed_files: u32,
    pub failed_files: u32,
    pub processing_time_ms: u64,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResponse {
    pub job: JobInfo,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: String,
    pub name: String,
    pub status: String,
    pub total_files: u32,
    pub completed_files: u32,
    pub failed_files: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub error: String,
}

// --- Implementation ---

impl ApiClient {
    pub fn new(base_url: &str, api_key: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(300)) // 5min for large PDFs
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.trim_end_matches('/').trim().to_string(),
            api_key: api_key.trim().to_string(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api/v1{}", self.base_url, path)
    }

    /// Test API connection by fetching templates.
    pub async fn test_connection(&self) -> Result<Vec<Template>, String> {
        self.get_templates().await
    }

    /// GET /api/v1/templates
    pub async fn get_templates(&self) -> Result<Vec<Template>, String> {
        let url = self.url("/templates");
        println!("[API] GET {} (key: {}...)", url, &self.api_key[..std::cmp::min(11, self.api_key.len())]);

        let resp = self
            .client
            .get(&url)
            .header("X-API-Key", &self.api_key)
            .send()
            .await
            .map_err(|e| format!("Connection error: {}", e))?;

        println!("[API] Response status: {}", resp.status());

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            println!("[API] Error body: {}", body);
            let err_msg = serde_json::from_str::<ApiError>(&body)
                .map(|e| e.error)
                .unwrap_or_else(|_| format!("HTTP {}: {}", status, body));
            return Err(err_msg);
        }

        let body = resp.text().await.map_err(|e| format!("Read error: {}", e))?;
        println!("[API] Response body length: {} bytes", body.len());
        let data: TemplatesResponse = serde_json::from_str(&body)
            .map_err(|e| format!("Parse error: {} (body: {})", e, &body[..std::cmp::min(200, body.len())]))?;
        println!("[API] Templates received: {}", data.templates.len());
        Ok(data.templates)
    }

    /// POST /api/v1/extract - Single PDF extraction (synchronous)
    pub async fn extract(
        &self,
        template_id: &str,
        pdf_base64: &str,
        file_name: &str,
    ) -> Result<ExtractResponse, String> {
        let body = ExtractRequest {
            template_id: template_id.to_string(),
            pdf_base64: pdf_base64.to_string(),
            file_name: file_name.to_string(),
            save_results: true,
        };

        let resp = self
            .client
            .post(&self.url("/extract"))
            .header("X-API-Key", &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Connection error: {}", e))?;

        if !resp.status().is_success() {
            let err: ApiError = resp.json().await.unwrap_or(ApiError {
                error: "Unknown error".into(),
            });
            return Err(err.error);
        }

        resp.json()
            .await
            .map_err(|e| format!("Parse error: {}", e))
    }

    /// POST /api/v1/batch - Multiple PDF batch extraction
    pub async fn batch_extract(
        &self,
        template_id: &str,
        files: Vec<BatchFile>,
        job_name: Option<String>,
    ) -> Result<BatchResponse, String> {
        let body = BatchRequest {
            template_id: template_id.to_string(),
            files,
            job_name,
        };

        let resp = self
            .client
            .post(&self.url("/batch"))
            .header("X-API-Key", &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Connection error: {}", e))?;

        if !resp.status().is_success() {
            let err: ApiError = resp.json().await.unwrap_or(ApiError {
                error: "Unknown error".into(),
            });
            return Err(err.error);
        }

        resp.json()
            .await
            .map_err(|e| format!("Parse error: {}", e))
    }

    /// GET /api/v1/jobs/:id/results?format=csv - Download results as CSV
    pub async fn get_results_csv(
        &self,
        job_id: &str,
        encoding: &str,
    ) -> Result<Vec<u8>, String> {
        let url = format!(
            "{}/results?format=csv&encoding={}",
            self.url(&format!("/jobs/{}", job_id)),
            encoding
        );

        let resp = self
            .client
            .get(&url)
            .header("X-API-Key", &self.api_key)
            .send()
            .await
            .map_err(|e| format!("Connection error: {}", e))?;

        if !resp.status().is_success() {
            let err: ApiError = resp.json().await.unwrap_or(ApiError {
                error: "Unknown error".into(),
            });
            return Err(err.error);
        }

        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("Download error: {}", e))
    }
}
