# IITM Placement Cell - Personalized HR Outreach

Local outreach tool using Ollama for personalized email drafting, Gmail SMTP for sending, and SQLite for local send logs.

## Setup

```bash
pip install -r requirements.txt
ollama serve
ollama pull llama3.2
python server.py
```

Open `index.html` in your browser and set the backend URL to:

```text
http://localhost:5000
```

## CSV Format

Upload separate CSV files inside the DS or ES portal. Expected columns:

```text
S.No, Date, Company Name, Job post, Job Post Link, Email ID
```

Rows can omit company name. When you click **Resolve companies**, the backend uses the email domain, fetches the company website when possible, and caches the resolved company name in `outreach.db`.

## DS and ES Portals

Use the DS / ES buttons in the sidebar. Each portal keeps separate:

- recipients
- Google Sheet CSV URL
- brochure/prospectus links
- attachment paths
- send logs view

## Editable Assets

In Settings you can edit:

- brochure/prospectus links, one per line
- local attachment paths, one per line

Attachment paths are read by the backend machine. Example:

```text
D:\IITM_OUTREACHER_PERSONALIZED\brochure.pdf
D:\IITM_OUTREACHER_PERSONALIZED\prospectus.pdf
```

These links are included in the AI prompt, and attachment paths are attached to sent emails.

## Local Database

The backend creates `outreach.db` with:

- `send_logs`: every successful or failed send attempt, including subject, full body, company, role, message, portal, links, and attachments
- `company_cache`: resolved company names by domain
- `assets`: editable links and attachment paths per portal

## API Endpoints

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET | `/api/ollama/models` | List installed Ollama models |
| POST | `/api/test-ollama` | Test Ollama connection |
| POST | `/api/test-gmail` | Test Gmail credentials |
| POST | `/api/generate` | Generate email via Ollama |
| POST | `/api/resolve-company` | Resolve company from email/domain |
| POST | `/api/enrich-recipient` | Resolve company and fetch job-link context |
| GET/POST | `/api/assets/<portal>` | Read/write DS or ES links and attachments |
| GET/DELETE | `/api/logs?portal=ds` | Read/clear local SQLite logs |
| POST | `/api/send` | Send email and log the result |
