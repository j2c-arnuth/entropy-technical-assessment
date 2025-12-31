# Daily Report Service

A NestJS service that ingests Procore daily report PDFs, stores them with metadata, and extracts structured data using a hybrid parsing strategy.

## Overview

This service demonstrates a document processing pipeline with the following capabilities:

- **PDF Ingestion**: Upload daily reports via REST API with automatic S3 storage and MongoDB metadata tracking
- **Async Processing**: SQS-based message queue decouples ingestion from extraction for scalability
- **Hybrid Extraction**: Combines deterministic regex parsing with LLM fallback for ambiguous content
- **Conflict Detection**: LLM-powered validation identifies inconsistencies in extracted data
- **Full Traceability**: Links extracted data back to source artifacts with status tracking

**Architecture Highlights:**
- Domain-driven module structure (ingestion, extraction, messaging, shared)
- Interval-based SQS consumer with configurable polling
- Mocked external dependencies for reliable testing (58 tests total)

This implementation is scoped for technical assessment demonstration. Production considerations are documented throughout the codebase.

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

### Messaging Module

#### Queue Validation on Startup

**Decision:** Validate queue existence during module initialization (fail-fast).

**Justification:**
- Catches configuration errors early before processing requests
- Prevents silent failures during runtime
- Provides clear error messages for debugging infrastructure issues

**Production consideration:** Add health check endpoint that includes queue
connectivity status for monitoring and load balancer health probes.

#### Rich Message Payload

**Decision:** Message body includes reportId, s3Key, tenant, project, subcontractor,
and publishedAt timestamp.

**Justification:**
- Supports pipeline observability by providing full context at each processing
  stage, enabling latency tracking and debugging across the async workflow
- Reduces operational coupling: the extraction worker has all context needed to
  execute without querying the database at runtime, following control/application
  plane separation principles

**Production considerations:**
- Consider message schema versioning (e.g., include a `version` field) for backward
  compatibility during payload evolution
- If product tiering requires differentiated processing (e.g., dedicated workers for
  enterprise tenants), implement routing at the control plane level—the ingestion
  service or a message router should direct messages to tier-specific queues. Workers
  should remain policy-agnostic executors that process their assigned queue without
  making decisions based on tenant attributes.

#### No Application-Level Retry Logic

**Decision:** Rely on SQS built-in retry and dead-letter queue (DLQ) configuration
rather than implementing retry logic in the service.

**Justification:**
- SQS provides robust, configurable retry mechanisms
- Keeps service code simple and focused on business logic
- DLQ handling separates concerns and enables dedicated failure handling

**Production consideration:** Configure DLQ with appropriate maxReceiveCount,
set up CloudWatch alarms for DLQ message counts, and implement a DLQ processor
for handling or replaying failed messages.

### Extraction Module

For details on the Procore daily report format used for extraction patterns, see
[docs/procore-daily-report-format.md](docs/procore-daily-report-format.md).

#### Hybrid Extraction Strategy

**Decision:** Use structured parsing (regex patterns) as primary extraction method,
with LLM fallback for ambiguous content and LLM-based conflict detection.

**Justification:**
- Procore daily reports have consistent section headers and formatting
- Structured extraction provides deterministic results for well-formatted content
- LLM is invoked only when patterns don't match cleanly (cost/latency optimization)
- LLM adds value for conflict detection across extracted sections

**Production consideration:** Refine regex patterns based on actual Procore PDF
samples. Consider externalizing patterns for easier updates without code changes.

#### Interval-Based SQS Polling

**Decision:** Use @nestjs/schedule with @Interval decorator for SQS message polling.

**Justification:**
- Simple, NestJS-native approach
- Auto-starts on module initialization
- Easy to configure polling frequency

**Production consideration:** Use long-polling with ReceiveMessage WaitTimeSeconds
for efficiency, or use AWS Lambda with SQS trigger for serverless scaling.

#### Sequential Message Processing

**Decision:** Process one message at a time within each polling interval.

**Justification:**
- Simpler error handling and status management
- Prevents overwhelming local resources

**Production consideration:** Implement batch processing with concurrency controls,
or use horizontal scaling with multiple consumer instances.

#### Self-Contained S3 Client

**Decision:** Extraction module maintains its own S3 client for downloading PDFs
rather than sharing with the ingestion module.

**Justification:**
- Keeps extraction module independent and self-contained
- Avoids circular dependencies between modules
- Follows same configuration patterns as other services

**Production consideration:** Extract S3 client to a shared infrastructure module
to reduce duplication and centralize AWS configuration.

#### LLM Conflict Detection

**Decision:** Use LLM to validate extracted data for inconsistencies in addition
to programmatic checks.

**Justification:**
- Catches semantic conflicts that programmatic checks can't detect
  (e.g., weather notes contradicting conditions)
- Adds validation layer without complex rule engines
- Demonstrates AI-assisted data quality

**Programmatic checks:**
- Manpower total vs sum of crew counts

**LLM-detected conflicts:**
- Weather notes contradicting conditions
- Work area status inconsistencies
- Cross-section logical conflicts

**Production consideration:** Consider caching LLM responses, implementing rate
limiting, and adding retry logic with exponential backoff.
