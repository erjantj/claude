from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import pdfplumber
import fitz  # PyMuPDF
import pandas as pd
import io
import logging
import os
import re
import time
from datetime import datetime, timedelta

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="StatementCSV API", version="1.0.0")

# CORS configuration
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory rate limiting (MVP without database)
rate_limits: dict[str, dict] = {}

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
FREE_TIER_DAILY_LIMIT = 5

# Regex patterns for transaction line detection (Strategy 4 fallback)
DATE_PATTERNS = [
    r"\d{1,2}/\d{1,2}/\d{2,4}",  # MM/DD/YYYY or M/D/YY
    r"\d{4}-\d{2}-\d{2}",  # YYYY-MM-DD
    r"[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}",  # Mon DD, YYYY
    r"\d{1,2}\.\d{1,2}\.\d{2,4}",  # DD.MM.YYYY
]
AMOUNT_PATTERN = r"-?\$?[\d,]+\.\d{2}"
DATE_RE = re.compile("|".join(f"({p})" for p in DATE_PATTERNS))
AMOUNT_RE = re.compile(AMOUNT_PATTERN)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _clean_header_row(row: list) -> list[str]:
    """Replace None/empty headers with Column_N, strip whitespace."""
    return [
        str(h).strip() if h and str(h).strip() else f"Column_{i}"
        for i, h in enumerate(row)
    ]


def _clean_rows(rows: list[list], num_columns: int | None = None) -> list[list[str]]:
    """Replace None with '', strip whitespace, drop fully empty rows, normalize width."""
    cleaned = []
    for row in rows:
        cells = [str(cell).strip() if cell is not None else "" for cell in row]
        if not any(c for c in cells):  # skip rows where every cell is empty
            continue
        if num_columns is not None:
            if len(cells) > num_columns:
                cells = cells[:num_columns]  # truncate extra columns
            elif len(cells) < num_columns:
                cells.extend([""] * (num_columns - len(cells)))  # pad missing columns
        cleaned.append(cells)
    return cleaned


def _is_valid_result(
    headers: list[str] | None, rows: list[list[str]] | None
) -> bool:
    """Return True if extraction produced usable data."""
    return bool(headers and rows and len(rows) >= 1)


# ---------------------------------------------------------------------------
# Strategy 1: pdfplumber with default settings (grid-line detection)
# ---------------------------------------------------------------------------

def _strategy_pdfplumber_default(pdf_bytes: bytes) -> tuple[list[str] | None, list[list[str]] | None]:
    headers = None
    all_rows: list[list] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue
                if headers is None:
                    headers = _clean_header_row(table[0])
                    all_rows.extend(table[1:])
                else:
                    all_rows.extend(table)

    if headers is None:
        return None, None
    return headers, _clean_rows(all_rows, len(headers))


# ---------------------------------------------------------------------------
# Strategy 2: pdfplumber with text-alignment strategy (borderless tables)
# ---------------------------------------------------------------------------

def _strategy_pdfplumber_text(pdf_bytes: bytes) -> tuple[list[str] | None, list[list[str]] | None]:
    table_settings = {
        "vertical_strategy": "text",
        "horizontal_strategy": "text",
        "snap_x_tolerance": 5,
        "snap_y_tolerance": 5,
        "join_x_tolerance": 5,
        "join_y_tolerance": 5,
    }

    headers = None
    all_rows: list[list] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables(table_settings=table_settings)
            for table in tables:
                if not table:
                    continue
                if headers is None:
                    headers = _clean_header_row(table[0])
                    all_rows.extend(table[1:])
                else:
                    all_rows.extend(table)

    if headers is None:
        return None, None
    return headers, _clean_rows(all_rows, len(headers))


# ---------------------------------------------------------------------------
# Strategy 3: PyMuPDF text-based table detection
# ---------------------------------------------------------------------------

def _strategy_pymupdf_text(pdf_bytes: bytes) -> tuple[list[str] | None, list[list[str]] | None]:
    headers = None
    all_rows: list[list] = []

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for page in doc:
            tabs = page.find_tables(strategy="text")
            for table in tabs.tables:
                data = table.extract()
                if not data:
                    continue
                if headers is None:
                    headers = _clean_header_row(data[0])
                    all_rows.extend(data[1:])
                else:
                    all_rows.extend(data)
    finally:
        doc.close()

    if headers is None:
        return None, None
    return headers, _clean_rows(all_rows, len(headers))


# ---------------------------------------------------------------------------
# Strategy 4: Regex-based transaction line parsing (last resort)
# ---------------------------------------------------------------------------

def _parse_transaction_line(line: str) -> list[str] | None:
    """Try to parse a single line as a financial transaction (date, desc, amount)."""
    date_match = DATE_RE.search(line)
    if not date_match:
        return None

    amounts = AMOUNT_RE.findall(line)
    if not amounts:
        return None

    date_str = date_match.group(0)
    # The description sits between the date and the first amount
    date_end = date_match.end()
    first_amount_match = AMOUNT_RE.search(line[date_end:])
    if first_amount_match:
        description = line[date_end : date_end + first_amount_match.start()].strip()
    else:
        description = line[date_end:].strip()

    # Use the last amount on the line (typically the transaction total)
    amount = amounts[-1]

    if not description:
        description = "Unknown"

    return [date_str, description, amount]


def _strategy_regex_fallback(pdf_bytes: bytes) -> tuple[list[str] | None, list[list[str]] | None]:
    rows: list[list[str]] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue
            for line in text.split("\n"):
                parsed = _parse_transaction_line(line.strip())
                if parsed:
                    rows.append(parsed)

    if not rows:
        return None, None
    return ["Date", "Description", "Amount"], rows


# ---------------------------------------------------------------------------
# Orchestrator: try strategies in order, return first success
# ---------------------------------------------------------------------------

def parse_pdf(contents: bytes) -> tuple[list[str] | None, list[list[str]] | None]:
    """Try multiple extraction strategies and return the first successful result."""
    strategies = [
        ("pdfplumber_default", _strategy_pdfplumber_default),
        ("pdfplumber_text", _strategy_pdfplumber_text),
        ("pymupdf_text", _strategy_pymupdf_text),
        ("regex_fallback", _strategy_regex_fallback),
    ]
    for _name, strategy_fn in strategies:
        try:
            headers, rows = strategy_fn(contents)
            if _is_valid_result(headers, rows):
                return headers, rows
        except Exception:
            continue
    return None, None


async def check_rate_limit(ip: str) -> bool:
    """Check if IP has exceeded free tier limit (5/day)."""
    now = datetime.now()

    if ip not in rate_limits:
        rate_limits[ip] = {"count": 0, "reset": now + timedelta(days=1)}

    if now > rate_limits[ip]["reset"]:
        rate_limits[ip] = {"count": 0, "reset": now + timedelta(days=1)}

    if rate_limits[ip]["count"] >= FREE_TIER_DAILY_LIMIT:
        return False

    rate_limits[ip]["count"] += 1
    return True


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "version": "1.0.0",
    }


@app.post("/api/convert")
async def convert_pdf(file: UploadFile = File(...), request: Request = None):
    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail={"error": "INVALID_FILE_TYPE", "message": "Please upload a PDF file"},
        )

    # Validate file size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "FILE_TOO_LARGE",
                "message": "File too large. Maximum size is 10MB",
            },
        )

    # Check rate limit
    if request:
        ip = request.client.host
        if not await check_rate_limit(ip):
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "FREE_TIER_LIMIT",
                    "message": "You've reached your free tier limit (5/day)",
                    "upgrade_url": "/pricing",
                },
            )

    start_time = time.time()

    try:
        headers, cleaned_rows = parse_pdf(contents)

        if not headers or not cleaned_rows:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "NO_TABLES_FOUND",
                    "message": "No tables detected in this PDF",
                },
            )

        df = pd.DataFrame(cleaned_rows, columns=headers)
        processing_time_ms = int((time.time() - start_time) * 1000)

        return JSONResponse({
            "success": True,
            "data": {
                "headers": headers,
                "rows": df.values.tolist(),
                "totalRows": len(df),
                "processingTime": processing_time_ms,
            },
            "preview": df.head(10).to_dict("records"),
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("PDF processing failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "PROCESSING_ERROR",
                "message": "Something went wrong. Please try again",
            },
        )


@app.post("/api/download")
async def download_csv(data: dict):
    headers = data.get("headers")
    rows = data.get("rows")

    if not headers or not rows:
        raise HTTPException(
            status_code=400,
            detail={"error": "INVALID_DATA", "message": "Headers and rows are required"},
        )

    df = pd.DataFrame(rows, columns=headers)

    output = io.StringIO()
    df.to_csv(output, index=False)
    output.seek(0)

    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=converted_statement.csv"
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
