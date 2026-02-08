from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import pdfplumber
import fitz  # PyMuPDF
import pandas as pd
from collections import Counter
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

# Regex patterns for transaction line detection
DATE_PATTERNS = [
    r"\d{1,2}/\d{1,2}/\d{2,4}",  # MM/DD/YYYY or M/D/YY
    r"\d{4}-\d{2}-\d{2}",  # YYYY-MM-DD
    r"[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}",  # Mon DD, YYYY
    r"\d{1,2}\.\d{1,2}\.\d{2,4}",  # DD.MM.YYYY
    r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)",  # DD Mon
]
AMOUNT_PATTERN = r"-?\$?[\d,]+\.\d{2}"
DATE_RE = re.compile("|".join(f"({p})" for p in DATE_PATTERNS))
AMOUNT_RE = re.compile(AMOUNT_PATTERN)
AMOUNT_FULL_RE = re.compile(r"^-?\$?[\d,]+\.\d{2}$")


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
# Strategy 4: Position-aware borderless statement parser
# ---------------------------------------------------------------------------

# Known header patterns for borderless financial statements.
# Each entry: (canonical_headers, keyword_sets_per_column)
BORDERLESS_HEADER_PATTERNS: list[tuple[list[str], list[set[str]]]] = [
    (
        ["Date", "Description", "Money out", "Money in", "Balance"],
        [{"date"}, {"description"}, {"money", "out"}, {"money", "in"}, {"balance"}],
    ),
    (
        ["Date", "Description", "Debit", "Credit", "Balance"],
        [{"date"}, {"description"}, {"debit"}, {"credit"}, {"balance"}],
    ),
    (
        ["Date", "Description", "Withdrawals", "Deposits", "Balance"],
        [{"date"}, {"description"}, {"withdrawals"}, {"deposits"}, {"balance"}],
    ),
    (
        ["Date", "Description", "Amount", "Balance"],
        [{"date"}, {"description"}, {"amount"}, {"balance"}],
    ),
]


def _group_words_by_y(
    words: list[dict], y_tolerance: float = 3.0
) -> list[list[dict]]:
    """Group word dicts into lines based on y-coordinate proximity."""
    if not words:
        return []
    sorted_words = sorted(words, key=lambda w: (w["top"], w["x0"]))
    lines: list[list[dict]] = []
    current_line: list[dict] = [sorted_words[0]]
    current_top = sorted_words[0]["top"]

    for w in sorted_words[1:]:
        if abs(w["top"] - current_top) <= y_tolerance:
            current_line.append(w)
        else:
            lines.append(sorted(current_line, key=lambda w: w["x0"]))
            current_line = [w]
            current_top = w["top"]
    lines.append(sorted(current_line, key=lambda w: w["x0"]))
    return lines


def _find_header_in_word_lines(
    word_lines: list[list[dict]],
) -> tuple[list[str], dict[str, tuple[float, float]], int] | None:
    """
    Scan word lines for a known header pattern.
    Returns (header_names, column_boundaries, line_index) or None.
    """
    for line_idx, wline in enumerate(word_lines):
        line_text = " ".join(w["text"] for w in wline).lower()
        line_words_set = set(line_text.split())

        for canonical_headers, keyword_sets in BORDERLESS_HEADER_PATTERNS:
            if all(kws.issubset(line_words_set) for kws in keyword_sets):
                # Found a match — compute column boundaries from word positions
                col_bounds = _compute_column_boundaries(wline, canonical_headers)
                if col_bounds:
                    return canonical_headers, col_bounds, line_idx

    return None


def _compute_column_boundaries(
    header_words: list[dict], canonical_headers: list[str]
) -> dict[str, tuple[float, float]] | None:
    """
    Map each canonical header to (left_boundary, right_boundary) using
    the x-positions of header words.
    """
    # Build mapping: canonical header -> (x0, x1) from header words
    header_positions: list[tuple[str, float, float]] = []
    used_indices: set[int] = set()

    for header_name in canonical_headers:
        header_tokens = header_name.lower().split()

        if len(header_tokens) == 1:
            # Single-word header (e.g. "Date", "Description", "Balance")
            for i, w in enumerate(header_words):
                if i not in used_indices and w["text"].lower() == header_tokens[0]:
                    header_positions.append((header_name, w["x0"], w["x1"]))
                    used_indices.add(i)
                    break
        else:
            # Multi-word header (e.g. "Money out", "Money in")
            for i in range(len(header_words) - len(header_tokens) + 1):
                if any(j in used_indices for j in range(i, i + len(header_tokens))):
                    continue
                words_match = all(
                    header_words[i + k]["text"].lower() == header_tokens[k]
                    for k in range(len(header_tokens))
                )
                if words_match:
                    x0 = header_words[i]["x0"]
                    x1 = header_words[i + len(header_tokens) - 1]["x1"]
                    header_positions.append((header_name, x0, x1))
                    for j in range(i, i + len(header_tokens)):
                        used_indices.add(j)
                    break

    if len(header_positions) != len(canonical_headers):
        return None

    # Sort by x0
    header_positions.sort(key=lambda h: h[1])

    # Compute boundaries: midpoints between adjacent headers
    bounds: dict[str, tuple[float, float]] = {}
    for i, (name, x0, x1) in enumerate(header_positions):
        if i == 0:
            left = 0.0
        else:
            prev_x1 = header_positions[i - 1][2]
            left = (prev_x1 + x0) / 2

        if i == len(header_positions) - 1:
            right = 9999.0  # extends to page edge
        else:
            next_x0 = header_positions[i + 1][1]
            right = (x1 + next_x0) / 2

        bounds[name] = (left, right)

    return bounds


def _assign_amounts_to_columns(
    amount_words: list[dict],
    col_bounds: dict[str, tuple[float, float]],
    amount_col_names: list[str],
) -> dict[str, str]:
    """
    Assign amount words to columns by their x1 (right-edge) position.
    Financial amounts are right-aligned, so x1 is the best indicator.
    """
    result = {name: "" for name in amount_col_names}
    tolerance = 20.0

    for aw in amount_words:
        x1 = aw["x1"]
        best_col = None
        best_dist = float("inf")
        for col_name in amount_col_names:
            left, right = col_bounds[col_name]
            if left - tolerance <= x1 <= right + tolerance:
                # Prefer the column whose right boundary is closest to x1
                dist = abs(right - x1)
                if dist < best_dist:
                    best_dist = dist
                    best_col = col_name
        if best_col:
            result[best_col] = aw["text"]

    return result


def _parse_borderless_line(
    wline: list[dict],
    col_bounds: dict[str, tuple[float, float]],
    amount_col_names: list[str],
    date_str: str | None,
) -> tuple[str, str, dict[str, str]]:
    """
    Parse a single word-line into (date, description, column_values).
    If date_str is provided, skip date tokens at the start of the line.
    """
    desc_parts = []
    amount_words = []

    if date_str:
        # Skip words that form the date prefix
        date_tokens = date_str.split()
        date_token_idx = 0
        past_date = False
        for w in wline:
            if AMOUNT_FULL_RE.match(w["text"]):
                amount_words.append(w)
            elif not past_date and date_token_idx < len(date_tokens):
                if w["text"] == date_tokens[date_token_idx]:
                    date_token_idx += 1
                    if date_token_idx == len(date_tokens):
                        past_date = True
                else:
                    past_date = True
                    desc_parts.append(w["text"])
            else:
                desc_parts.append(w["text"])
    else:
        for w in wline:
            if AMOUNT_FULL_RE.match(w["text"]):
                amount_words.append(w)
            else:
                desc_parts.append(w["text"])

    description = " ".join(desc_parts)
    col_values = _assign_amounts_to_columns(
        amount_words, col_bounds, amount_col_names
    )
    return date_str or "", description, col_values


# Lines matching these patterns signal end of the transaction table.
_END_MARKERS = re.compile(
    r"^(Continued|Anything Wrong|Credit interest|How it\s*works|Get in touch)",
    re.IGNORECASE,
)


def _strategy_borderless_statement(
    pdf_bytes: bytes,
) -> tuple[list[str] | None, list[list[str]] | None]:
    """
    Strategy for borderless financial statements (Barclays, etc.).

    Uses word-level x-coordinates to detect column boundaries from the header
    line, then parses transaction lines and assigns amounts to correct columns.
    Handles same-date transaction groups where only the first line has the date.
    """
    headers: list[str] | None = None
    col_bounds: dict[str, tuple[float, float]] | None = None
    amount_col_names: list[str] = []
    rows: list[list[str]] = []
    last_date: str = ""
    end_balance_seen = False

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            if end_balance_seen:
                break

            words = page.extract_words(
                keep_blank_chars=False, x_tolerance=3, y_tolerance=3
            )
            if not words:
                continue

            word_lines = _group_words_by_y(words)

            start_line = 0
            # Check for header on each page (statements often repeat headers)
            result = _find_header_in_word_lines(word_lines)
            if result is not None:
                headers, col_bounds, header_line_idx = result
                amount_col_names = [
                    h for h in headers if h not in ("Date", "Description")
                ]
                start_line = header_line_idx + 1
            elif headers is None:
                continue  # Haven't found headers yet

            for wline in word_lines[start_line:]:
                line_text = " ".join(w["text"] for w in wline)
                stripped = line_text.strip()

                # Stop at end-of-table markers
                if _END_MARKERS.match(stripped):
                    break

                # Check if line starts with a date
                date_match = DATE_RE.match(stripped)

                # Check if line has any amounts
                has_amounts = any(
                    AMOUNT_FULL_RE.match(w["text"]) for w in wline
                )

                if date_match:
                    # New transaction with an explicit date
                    date_str = date_match.group(0)
                    last_date = date_str
                    date_str, desc, col_vals = _parse_borderless_line(
                        wline, col_bounds, amount_col_names, date_str
                    )
                    row = [date_str, desc]
                    for cn in amount_col_names:
                        row.append(col_vals[cn])
                    rows.append(row)

                    if "end balance" in desc.lower():
                        end_balance_seen = True
                        break

                elif has_amounts and last_date:
                    # Same-date transaction (date not repeated on this line)
                    _, desc, col_vals = _parse_borderless_line(
                        wline, col_bounds, amount_col_names, None
                    )
                    row = [last_date, desc]
                    for cn in amount_col_names:
                        row.append(col_vals[cn])
                    rows.append(row)

                else:
                    # Continuation line — merge into previous row's description
                    if rows and stripped:
                        rows[-1][1] += " " + stripped

    if headers is None:
        return None, None
    return headers, rows


# ---------------------------------------------------------------------------
# Strategy 5: Regex-based transaction line parsing (last resort)
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
        ("borderless_statement", _strategy_borderless_statement),
        ("pdfplumber_text", _strategy_pdfplumber_text),
        ("pymupdf_text", _strategy_pymupdf_text),
        ("regex_fallback", _strategy_regex_fallback),
    ]
    for name, strategy_fn in strategies:
        try:
            headers, rows = strategy_fn(contents)
            if _is_valid_result(headers, rows):
                logger.info("Strategy '%s' succeeded with %d rows", name, len(rows))
                return headers, rows
        except Exception as e:
            logger.debug("Strategy '%s' failed: %s", name, e)
            continue
    return None, None


# ---------------------------------------------------------------------------
# Summary extraction: dates, credited, debited
# ---------------------------------------------------------------------------

# Column names that indicate credits (money in)
_CREDIT_COLUMNS = {"money in", "credit", "deposits", "deposit"}
# Column names that indicate debits (money out)
_DEBIT_COLUMNS = {"money out", "debit", "withdrawals", "withdrawal"}

_DATE_PARSE_FORMATS = [
    "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y", "%d/%m/%y",
    "%Y-%m-%d",
    "%b %d, %Y", "%b %d %Y",
    "%d %b %Y", "%d %b",
    "%d.%m.%Y", "%d.%m.%y",
]


def _parse_date(text: str) -> datetime | None:
    """Try to parse a date string using common formats."""
    text = text.strip()
    if not text:
        return None
    for fmt in _DATE_PARSE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _parse_amount(text: str) -> float | None:
    """Parse an amount string like '$1,234.56' or '-1234.56' into a float."""
    text = text.strip()
    if not text:
        return None
    cleaned = text.replace("$", "").replace(",", "").replace(" ", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _find_column_index(headers: list[str], candidates: set[str]) -> int | None:
    """Find the first header whose lowercase name matches one of the candidates."""
    for i, h in enumerate(headers):
        if h.lower().strip() in candidates:
            return i
    return None


_YEAR_RE = re.compile(r"\b(20\d{2})\b")


def _extract_year_from_pdf(pdf_bytes: bytes) -> int | None:
    """Extract the most likely statement year from PDF text (headers, titles, etc.)."""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            # Check first 2 pages — the year is almost always on page 1
            for page in pdf.pages[:2]:
                text = page.extract_text()
                if not text:
                    continue
                years = [int(m) for m in _YEAR_RE.findall(text)]
                if years:
                    return Counter(years).most_common(1)[0][0]
    except Exception:
        pass
    return None


def compute_summary(headers: list[str], rows: list[list[str]], pdf_bytes: bytes | None = None) -> dict:
    """
    Compute statement summary: date range and total credited/debited.

    Handles multiple column naming conventions:
    - Money in / Money out (Barclays)
    - Credit / Debit
    - Deposits / Withdrawals
    - Single 'Amount' column (positive = credit, negative = debit)
    """
    summary: dict = {
        "startDate": None,
        "endDate": None,
        "totalCredited": None,
        "totalDebited": None,
    }

    # --- Date range ---
    date_col = _find_column_index(headers, {"date"})
    if date_col is not None:
        dates = []
        for row in rows:
            if date_col < len(row):
                parsed = _parse_date(row[date_col])
                if parsed:
                    dates.append(parsed)

        # Fix yearless dates (defaulted to 1900) by extracting year from PDF
        if dates and any(d.year == 1900 for d in dates):
            year = _extract_year_from_pdf(pdf_bytes) if pdf_bytes else None
            if year:
                dates = [d.replace(year=year) for d in dates]

        if dates:
            summary["startDate"] = min(dates).strftime("%Y-%m-%d")
            summary["endDate"] = max(dates).strftime("%Y-%m-%d")

    # --- Credits and debits ---
    credit_col = _find_column_index(headers, _CREDIT_COLUMNS)
    debit_col = _find_column_index(headers, _DEBIT_COLUMNS)

    if credit_col is not None and debit_col is not None:
        total_credited = 0.0
        total_debited = 0.0
        for row in rows:
            if credit_col < len(row):
                amt = _parse_amount(row[credit_col])
                if amt is not None:
                    total_credited += abs(amt)
            if debit_col < len(row):
                amt = _parse_amount(row[debit_col])
                if amt is not None:
                    total_debited += abs(amt)
        summary["totalCredited"] = round(total_credited, 2)
        summary["totalDebited"] = round(total_debited, 2)
    else:
        # Single "Amount" column — positive = credit, negative = debit
        amount_col = _find_column_index(headers, {"amount"})
        if amount_col is not None:
            total_credited = 0.0
            total_debited = 0.0
            for row in rows:
                if amount_col < len(row):
                    amt = _parse_amount(row[amount_col])
                    if amt is not None:
                        if amt >= 0:
                            total_credited += amt
                        else:
                            total_debited += abs(amt)
            summary["totalCredited"] = round(total_credited, 2)
            summary["totalDebited"] = round(total_debited, 2)

    return summary


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
        summary = compute_summary(headers, cleaned_rows, contents)

        # Derive CSV filename from the original upload name
        original_name = file.filename or "statement.pdf"
        csv_name = original_name.rsplit(".", 1)[0] + ".csv"

        return JSONResponse({
            "success": True,
            "data": {
                "headers": headers,
                "rows": df.values.tolist(),
                "totalRows": len(df),
                "processingTime": processing_time_ms,
                "summary": summary,
                "fileName": csv_name,
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
