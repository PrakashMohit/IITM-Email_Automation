import json
import os
import re
import smtplib
import sqlite3
from datetime import datetime
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

import requests
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "outreach.db"
USER_AGENT = "Mozilla/5.0 (compatible; IITMOutreach/1.0)"


class TitleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_title = False
        self.title = ""
        self.meta = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == "title":
            self.in_title = True
        if tag.lower() == "meta":
            name = (attrs.get("name") or attrs.get("property") or "").lower()
            content = attrs.get("content") or ""
            if name and content:
                self.meta[name] = content

    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with db() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS send_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                portal TEXT,
                email TEXT NOT NULL,
                company TEXT,
                job_post TEXT,
                job_post_link TEXT,
                subject TEXT,
                body TEXT,
                status TEXT NOT NULL,
                message TEXT,
                from_email TEXT,
                attachments TEXT,
                links TEXT
            )
            """
        )
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS company_cache (
                domain TEXT PRIMARY KEY,
                company_name TEXT NOT NULL,
                source TEXT,
                confidence TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS assets (
                portal TEXT PRIMARY KEY,
                links TEXT,
                attachment_paths TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def clean_domain(value):
    value = (value or "").strip().lower()
    if "@" in value:
        value = value.rsplit("@", 1)[1]
    if not value:
        return ""
    parsed = urlparse(value if "://" in value else f"https://{value}")
    domain = parsed.netloc or parsed.path
    domain = domain.split("/")[0].split(":")[0]
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def fallback_company_from_domain(domain):
    stem = clean_domain(domain).split(".")[0]
    parts = re.split(r"[-_]+", stem)
    return " ".join(p.upper() if len(p) <= 3 else p.capitalize() for p in parts if p)


def normalize_company_name(text, domain):
    text = re.sub(r"\s+", " ", text or "").strip(" -|:")
    if not text:
        return fallback_company_from_domain(domain)
    text = re.split(r"\s+[|–—-]\s+| - | – | — ", text)[0].strip()
    text = re.sub(r"\b(home|careers|jobs|official site|homepage)\b", "", text, flags=re.I).strip(" -|:")
    return text[:120] or fallback_company_from_domain(domain)


def fetch_page_summary(url):
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=8, allow_redirects=True)
        r.raise_for_status()
        parser = TitleParser()
        parser.feed(r.text[:120000])
        title = parser.meta.get("og:site_name") or parser.title
        description = parser.meta.get("og:description") or parser.meta.get("description") or ""
        return {"ok": True, "url": r.url, "title": title.strip(), "description": description.strip()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def resolve_company(domain):
    domain = clean_domain(domain)
    if not domain:
        return {"company": "", "domain": "", "source": "empty", "confidence": "low"}

    with db() as con:
        cached = con.execute("SELECT * FROM company_cache WHERE domain = ?", (domain,)).fetchone()
        if cached:
            return {
                "company": cached["company_name"],
                "domain": domain,
                "source": cached["source"],
                "confidence": cached["confidence"],
                "cached": True,
            }

    result = None
    for scheme in ("https", "http"):
        result = fetch_page_summary(f"{scheme}://{domain}")
        if result["ok"] and result.get("title"):
            break

    if result and result.get("ok") and result.get("title"):
        company = normalize_company_name(result["title"], domain)
        source = result.get("url") or domain
        confidence = "medium"
    else:
        company = fallback_company_from_domain(domain)
        source = "domain-fallback"
        confidence = "low"

    with db() as con:
        con.execute(
            """
            INSERT INTO company_cache(domain, company_name, source, confidence, updated_at)
            VALUES(?, ?, ?, ?, ?)
            ON CONFLICT(domain) DO UPDATE SET
              company_name=excluded.company_name,
              source=excluded.source,
              confidence=excluded.confidence,
              updated_at=excluded.updated_at
            """,
            (domain, company, source, confidence, now_iso()),
        )
    return {"company": company, "domain": domain, "source": source, "confidence": confidence, "cached": False}


def log_send(data, status, message):
    with db() as con:
        cur = con.execute(
            """
            INSERT INTO send_logs (
                created_at, portal, email, company, job_post, job_post_link, subject, body,
                status, message, from_email, attachments, links
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now_iso(),
                data.get("portal") or "",
                data.get("to") or data.get("email") or "",
                data.get("company") or "",
                data.get("jobPost") or "",
                data.get("jobLink") or "",
                data.get("subject") or "",
                data.get("body") or "",
                status,
                message,
                data.get("fromEmail") or "",
                json.dumps(data.get("attachments") or []),
                json.dumps(data.get("links") or []),
            ),
        )
        return cur.lastrowid


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "IITM Outreach Backend", "ai": "ollama", "database": str(DB_PATH)})


@app.route("/", methods=["GET"])
def frontend():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:filename>", methods=["GET"])
def frontend_assets(filename):
    if filename in {"app.js", "styles.css"}:
        return send_from_directory(BASE_DIR, filename)
    return jsonify({"error": "Not found"}), 404


@app.route("/api/ollama/models", methods=["GET"])
def list_models():
    try:
        r = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
        r.raise_for_status()
        models = [m["name"] for m in r.json().get("models", [])]
        return jsonify({"ok": True, "models": models})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "models": []}), 200


@app.route("/api/test-ollama", methods=["POST"])
def test_ollama():
    data = request.json or {}
    model = data.get("model", "llama3.2:3b")
    base_url = data.get("baseUrl", OLLAMA_BASE_URL).rstrip("/")
    try:
        payload = {"model": model, "prompt": 'Reply with only the word "OK".', "stream": False, "options": {"num_predict": 5}}
        r = requests.post(f"{base_url}/api/generate", json=payload, timeout=30)
        r.raise_for_status()
        return jsonify({"ok": True, "response": r.json().get("response", "").strip()})
    except requests.exceptions.ConnectionError:
        return jsonify({"ok": False, "error": "Cannot reach Ollama. Make sure it is running: ollama serve"}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 200


@app.route("/api/generate", methods=["POST"])
def generate():
    data = request.json or {}
    prompt = data.get("prompt", "")
    model = data.get("model", "llama3.2")
    base_url = data.get("baseUrl", OLLAMA_BASE_URL).rstrip("/")
    if not prompt:
        return jsonify({"error": "No prompt provided"}), 400
    try:
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.75, "num_predict": 800, "top_p": 0.9},
        }
        r = requests.post(f"{base_url}/api/generate", json=payload, timeout=120)
        r.raise_for_status()
        body = r.json().get("response", "").strip()
        if not body:
            return jsonify({"error": "Empty response from Ollama"}), 500
        return jsonify({"ok": True, "body": body})
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "Cannot reach Ollama at " + base_url + ". Run: ollama serve"}), 503
    except requests.exceptions.Timeout:
        return jsonify({"error": "Ollama timed out. Model may still be loading."}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/test-gmail", methods=["POST"])
def test_gmail():
    data = request.json or {}
    email = data.get("email", "")
    app_password = data.get("appPassword", "")
    if not email or not app_password:
        return jsonify({"ok": False, "message": "Email and app password required"}), 400
    try:
        server = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10)
        server.login(email, app_password.replace(" ", ""))
        server.quit()
        return jsonify({"ok": True, "message": "Gmail connected successfully"})
    except smtplib.SMTPAuthenticationError:
        return jsonify({"ok": False, "message": "Auth failed. Check email and App Password."}), 200
    except Exception as e:
        return jsonify({"ok": False, "message": str(e)}), 200


@app.route("/api/resolve-company", methods=["POST"])
def resolve_company_api():
    data = request.json or {}
    domain = clean_domain(data.get("domain") or data.get("email") or data.get("url"))
    return jsonify({"ok": True, **resolve_company(domain)})


@app.route("/api/enrich-recipient", methods=["POST"])
def enrich_recipient():
    data = request.json or {}
    resolved = resolve_company(data.get("email") or data.get("domain") or data.get("company"))
    context = {}
    if data.get("jobLink"):
        context = fetch_page_summary(data["jobLink"])
    return jsonify({"ok": True, "company": resolved, "postContext": context})


@app.route("/api/assets/<portal>", methods=["GET", "POST"])
def assets(portal):
    portal = portal.lower()
    if request.method == "POST":
        data = request.json or {}
        with db() as con:
            con.execute(
                """
                INSERT INTO assets(portal, links, attachment_paths, updated_at)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(portal) DO UPDATE SET
                  links=excluded.links,
                  attachment_paths=excluded.attachment_paths,
                  updated_at=excluded.updated_at
                """,
                (portal, data.get("links", ""), data.get("attachmentPaths", ""), now_iso()),
            )
        return jsonify({"ok": True})
    with db() as con:
        row = con.execute("SELECT * FROM assets WHERE portal = ?", (portal,)).fetchone()
    return jsonify({"ok": True, "assets": dict(row) if row else {"portal": portal, "links": "", "attachment_paths": ""}})


@app.route("/api/logs", methods=["GET"])
def logs_api():
    portal = (request.args.get("portal") or "").lower()
    limit = min(int(request.args.get("limit", 300)), 1000)
    sql = "SELECT * FROM send_logs"
    params = []
    if portal:
        sql += " WHERE lower(portal) = ?"
        params.append(portal)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with db() as con:
        rows = [dict(row) for row in con.execute(sql, params).fetchall()]
    return jsonify({"ok": True, "logs": rows})


@app.route("/api/logs", methods=["DELETE"])
def clear_logs_api():
    portal = (request.args.get("portal") or "").lower()
    with db() as con:
        if portal:
            con.execute("DELETE FROM send_logs WHERE lower(portal) = ?", (portal,))
        else:
            con.execute("DELETE FROM send_logs")
    return jsonify({"ok": True})


@app.route("/api/send", methods=["POST"])
def send_email():
    data = request.json or {}
    to = data.get("to", "")
    subject = data.get("subject", "")
    body = data.get("body", "")
    from_name = data.get("fromName", "IITM Placement Cell")
    from_email = data.get("fromEmail", "")
    app_password = data.get("appPassword", "")
    attachments = data.get("attachments") or []

    if not all([to, subject, body, from_email, app_password]):
        message = "Missing required fields: to, subject, body, fromEmail, appPassword"
        log_id = log_send(data, "failed", message)
        return jsonify({"error": message, "logId": log_id}), 400

    try:
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{from_email}>"
        msg["To"] = to

        alternative = MIMEMultipart("alternative")
        alternative.attach(MIMEText(body, "plain", "utf-8"))
        html_body = body.replace("\n", "<br>")
        alternative.attach(
            MIMEText(
                f"<html><body style='font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#222'>{html_body}</body></html>",
                "html",
                "utf-8",
            )
        )
        msg.attach(alternative)

        missing = []
        for path_value in attachments:
            path = Path(str(path_value)).expanduser()
            if not path.is_absolute():
                path = BASE_DIR / path
            if not path.exists() or not path.is_file():
                missing.append(str(path_value))
                continue
            part = MIMEApplication(path.read_bytes(), Name=path.name)
            part["Content-Disposition"] = f'attachment; filename="{path.name}"'
            msg.attach(part)

        if missing:
            raise FileNotFoundError("Attachment not found: " + ", ".join(missing))

        server = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15)
        server.login(from_email, app_password.replace(" ", ""))
        server.sendmail(from_email, to, msg.as_string())
        server.quit()
        log_id = log_send(data, "sent", "OK")
        return jsonify({"ok": True, "message": f"Email sent to {to}", "logId": log_id})
    except smtplib.SMTPAuthenticationError:
        log_id = log_send(data, "failed", "Gmail auth failed. Check App Password.")
        return jsonify({"error": "Gmail auth failed. Check App Password.", "logId": log_id}), 401
    except smtplib.SMTPRecipientsRefused:
        log_id = log_send(data, "failed", f"Recipient refused: {to}")
        return jsonify({"error": f"Recipient refused: {to}", "logId": log_id}), 400
    except Exception as e:
        log_id = log_send(data, "failed", str(e))
        return jsonify({"error": str(e), "logId": log_id}), 500

init_db()


if __name__ == "__main__":
    print("=" * 55)
    print("  IITM Placement Cell - Outreach Backend")
    print("  AI: Ollama (local)  |  Email: Gmail SMTP")
    print(f"  DB: {DB_PATH}")
    print("=" * 55)
    print("  Make sure Ollama is running: ollama serve")
    print("  Then pull a model:  ollama pull llama3.2")
    print("=" * 55)
    app.run(host="0.0.0.0", port=5000, debug=False)
