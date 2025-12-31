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
