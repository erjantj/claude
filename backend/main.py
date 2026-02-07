from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import pdfplumber
import pandas as pd
import io
import os
import time
from datetime import datetime, timedelta

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
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            all_rows = []
            headers = None

            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    if not table:
                        continue
                    if headers is None and table:
                        headers = [str(h) if h else f"Column_{i}" for i, h in enumerate(table[0])]
                        all_rows.extend(table[1:])
                    else:
                        all_rows.extend(table)

        if not headers or not all_rows:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "NO_TABLES_FOUND",
                    "message": "No tables detected in this PDF",
                },
            )

        # Clean rows: replace None values with empty strings
        cleaned_rows = [
            [str(cell) if cell is not None else "" for cell in row]
            for row in all_rows
        ]

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
