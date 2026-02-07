# StatementCSV - PDF to CSV Converter

## Project Overview

StatementCSV is a web application that converts PDF financial statements and tabular documents to CSV format. The goal is to eliminate manual data entry for individuals, small business owners, accountants, and bookkeepers.

## Current State

The project currently lives in `bank-statement-converter/` as a client-side-only React app using Vite, TypeScript, and PDF.js for browser-based PDF parsing. It exports to XLSX/CSV. This is a prototype and needs to be migrated to the target architecture described below.

## Target Architecture (per PRD)

### Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, react-dropzone
- **Backend:** Python 3.11+, FastAPI, pdfplumber (primary), PyMuPDF (fallback), pandas
- **Payments:** Stripe (Week 2+)
- **Hosting:** Vercel (frontend) + Railway/Render (backend)
- **Database:** None for MVP (stateless). PostgreSQL later for user accounts.

### Project Structure (Target)

```
pdf-converter/
├── backend/           # Python FastAPI backend
│   ├── main.py        # FastAPI app with /api/convert, /api/download, /api/health
│   ├── requirements.txt
│   ├── Procfile
│   └── railway.toml
└── frontend/          # Next.js 14 frontend
    ├── app/
    │   ├── components/
    │   │   ├── FileUpload.tsx
    │   │   ├── ResultsTable.tsx
    │   │   └── PricingModal.tsx
    │   └── page.tsx
    └── package.json
```

## API Endpoints

- `POST /api/convert` - Upload PDF, returns extracted table data (headers, rows, preview)
- `POST /api/download` - Accepts headers+rows JSON, returns CSV file stream
- `GET /api/health` - Health check
- `POST /api/create-checkout-session` - Stripe checkout (Week 2+)
- `POST /api/webhook` - Stripe webhook handler (Week 2+)

## MVP Features (Week 1)

### 1. File Upload
- Support drag-and-drop file upload
- Support click-to-browse file selection
- Accept PDF files up to 10MB in size
- Display file name and size after upload
- Show clear error messages for invalid files
- Support single file upload only (MVP)

### 2. PDF Processing & Table Detection
- Parse PDF and identify table structures
- Extract text while preserving row/column relationships
- Handle multi-page PDFs (extract tables from all pages)
- Detect common statement formats (bank statements, credit card statements)
- Handle both text-based and image-based PDFs (OCR for images)

### 3. Data Preview
- Display first 10 rows of extracted data in table format
- Show column headers clearly
- Indicate total number of rows detected
- Allow user to verify data quality before download

### 4. CSV Download
- Generate properly formatted CSV file
- Include column headers
- Handle special characters and commas in data
- Use UTF-8 encoding
- Name file appropriately (e.g., `converted_[original_filename].csv`)
- Trigger automatic download

### 5. Error Handling
- Display clear error messages for:
  - Invalid file format
  - File too large
  - No tables detected
  - Processing failure
- Provide suggested actions for each error type
- Log errors for debugging (server-side)

## Key Backend Dependencies

```
fastapi==0.109.0
uvicorn[standard]==0.27.0
pdfplumber==0.11.0
PyMuPDF==1.23.0
pandas==2.2.0
python-multipart==0.0.9
stripe==8.0.0  # Week 2+
```

## Key Frontend Dependencies

- next (14, App Router)
- react, react-dom (18)
- typescript
- tailwindcss
- shadcn/ui (button, card, table components)
- react-dropzone
- lucide-react

## Business Rules

### Free Tier (MVP - Week 1)
- 5 conversions/day per IP
- 5MB file size limit
- Rate limiting via in-memory storage
- No payment processing

### Paid Tiers (Week 2+)
- Pay-per-use: $2.99/conversion (10MB, no watermark)
- Pro: $9.99/month (50 conversions, 25MB, priority processing)
- Unlimited: $29.99/month (unlimited, 50MB, API access)

## File Validation Rules

- Accept only PDF files (validate on client and server)
- Max file size: 10MB (free), up to 50MB (paid tiers)
- Sanitize file names to prevent injection
- Delete uploaded files immediately after processing
- Never store user files or data

## Error Codes

- `INVALID_FILE_TYPE` - Not a PDF
- `FILE_TOO_LARGE` - Exceeds size limit
- `NO_TABLES_FOUND` - No tables detected in PDF
- `PROCESSING_ERROR` - General processing failure
- `FREE_TIER_LIMIT` (HTTP 429) - Rate limit exceeded

## Performance Targets

- File upload: <5 seconds for 10MB
- PDF processing: <30 seconds for 2-10 page statement
- CSV generation: <5 seconds
- Page load: <2 seconds
- Conversion success rate: >80%

## Security Requirements

- HTTPS for all connections
- File type validation on client and server
- File name sanitization
- File size limits enforced
- Uploaded files deleted immediately after processing
- No user data stored
- Rate limiting (10 conversions/hour/IP for free tier)
- CORS configured properly (not wildcard in production)

## Environment Variables

### Backend (.env)
```
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com
STRIPE_SECRET_KEY=sk_test_xxx          # Week 2+
STRIPE_WEBHOOK_SECRET=whsec_xxx        # Week 2+
SUCCESS_URL=https://yourdomain.com/success   # Week 2+
CANCEL_URL=https://yourdomain.com/cancel     # Week 2+
```

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx  # Week 2+
```

## Development Commands

### Backend
```bash
uvicorn main:app --reload          # Dev server
pytest                             # Tests
pip freeze > requirements.txt      # Update deps
```

### Frontend
```bash
npm run dev                        # Dev server
npm run build                      # Production build
npm run lint                       # Lint
```

## Implementation Phases

1. **Week 1 (MVP):** Backend API + Frontend UI, free tier only, no auth
2. **Week 2:** Stripe payment integration, pricing modal, checkout flow
3. **Week 3+:** Optional database (PostgreSQL) for user accounts, conversion history
4. **Future:** Batch processing, column customization, Excel export, API access, browser extension, bank template recognition

## UI Design Principles

- Single-page application
- Clean, minimal interface
- Mobile-first responsive design
- WCAG 2.1 AA accessible
- Colors: blue/green primary, green success, red error, gray neutrals
- Drag-and-drop upload area with dashed border
- Data preview table (first 10 rows) before download

## Testing

- Unit tests: PDF parsing, CSV generation, file validation, error handling
- Integration tests: Upload-to-conversion pipeline, API responses, downloads
- Manual tests: Various PDF formats (bank/credit card statements, invoices), file sizes, browsers, mobile
- Test data: Anonymized bank statements, credit card statements, generic PDF tables, edge cases (empty tables, single-column, multi-page)
