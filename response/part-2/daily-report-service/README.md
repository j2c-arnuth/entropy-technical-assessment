# Daily Report Service

NestJS service that processes Procore daily report PDFs.

## Prerequisites

- Node.js 20+
- Docker & Docker Compose

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Start infrastructure (MongoDB, LocalStack, ElasticMQ):
```bash
docker compose up -d
```

4. Run the application:
```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## Infrastructure

| Service | Port | Purpose |
|---------|------|---------|
| MongoDB | 27017 | Document storage |
| LocalStack | 4566 | S3-compatible file storage |
| ElasticMQ | 9324 | SQS-compatible message queue |

## Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

## Project Structure

```
src/
├── ingestion/          # File upload & storage
├── extraction/         # PDF parsing & LLM extraction
├── messaging/          # Queue publishing
└── shared/             # Common utilities, schemas
test/
└── *.e2e-spec.ts       # E2E tests
```

## Processing Pipeline

The service processes daily reports through an asynchronous pipeline. This interpretation
aligns with the requirement to "publish an SQS message for processing" - the message
triggers extraction as a separate step from ingestion.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INGESTION                                      │
│                                                                             │
│   Client ──► POST /reports/upload ──► S3 Storage ──► MongoDB ──► SQS        │
│              (PDF + metadata)         (raw file)     (PENDING)   (trigger)  │
└─────────────────────────────────────────────────────────────────────────────┘
                                                           │
                                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTRACTION                                     │
│                                                                             │
│   SQS Consumer ──► Download PDF ──► Parse & Extract ──► MongoDB             │
│   (poll queue)     (from S3)        (pdf-parse + LLM)   (COMPLETED/FAILED)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Status Transitions:**

| Status | Description |
|--------|-------------|
| PENDING | Report uploaded, awaiting extraction |
| PROCESSING | Extraction in progress |
| COMPLETED | Extraction successful, data available |
| FAILED | Extraction failed (see error details) |

## Design Decisions

### Minimal Viable Implementation

This implementation is scoped for technical assessment demonstration, not production
readiness.

**What's included:**

- Single DailyReport schema with embedded extracted data
- Basic DTOs for upload and response
- Simple status enum for processing workflow

**What's intentionally excluded (would be needed for production):**

- Multi-tenant isolation and access control
- Evidence chain-of-custody with confidence scores
- Audit trails and soft deletes
- Discriminated event types for cross-report analysis
- Pagination and query utilities
- Custom exception classes

### Free-Form String Fields

The following fields are implemented as free-form strings rather than enums:

| Field | Rationale |
|-------|-----------|
| `weather.conditions` | LLM extraction may return varied descriptions ("Clear", "Partly Cloudy", "Light Rain"). Strict enums would require normalization logic and risk validation failures. |
| `crews[].trade` | Trade types vary by project and subcontractor naming conventions. Enums would need to be exhaustive or require constant updates. |
| `workAreas[].name` | Work area names are project-specific (e.g., "Upper Concourse", "Section 12A"). Cannot be pre-defined. |

For production, consider adding optional normalization utilities that map common
variations to canonical values while preserving original text.

### Embedded Extracted Data

Extracted data is embedded as a subdocument rather than a separate collection because:

- Extracted data is always accessed together with the parent report
- Simplifies queries and reduces join overhead
- Appropriate for the minimal viable implementation scope

For production, consider separating if independent querying of extracted data
across reports is required.

### Ingestion Module

#### Direct SQS Message Publishing

**Decision:** Ingestion module calls messaging service directly after successful upload.

**Justification:** Simpler flow with fewer round-trips. Provides an atomic operation
from the client's perspective - upload either succeeds completely (file stored,
metadata saved, message queued) or fails.

**Production consideration:** Consider event-driven architecture with database change
streams or outbox pattern for guaranteed delivery and better decoupling.

#### S3 Key Generation Strategy

**Decision:** Use `{date}/{uuid}/{original-filename}` pattern.

**Justification:**
- Date prefix enables time-based partitioning and lifecycle policies
- UUID ensures uniqueness and prevents key collisions
- Original filename preserved for human readability and debugging

**Production consideration:** Add tenant/project prefixes for multi-tenant isolation
(e.g., `{tenant}/{project}/{date}/{uuid}/{filename}`) and configure bucket policies.

#### No Bucket Auto-Creation

**Decision:** Assume S3 bucket exists (created via infrastructure setup).

**Justification:** Separation of concerns - infrastructure provisioning is distinct
from application logic. The application should not manage its own infrastructure.

**Production consideration:** Use Infrastructure as Code (Terraform, CloudFormation)
for bucket provisioning with proper encryption, versioning, and access policies.

#### Synchronous Upload Flow

**Decision:** Upload to S3, save to MongoDB, and publish SQS message in a single
synchronous request.

**Justification:** Simple request-response model provides immediate feedback to
the client. Appropriate for the file sizes expected in daily report PDFs.

**Production consideration:** For large files, consider presigned URLs for direct
S3 upload from the client, followed by async metadata capture triggered by S3 events.
