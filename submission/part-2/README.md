# Part 2: Coding Exercise

A NestJS service that processes Procore daily report PDFs.

## Requirements

The service must:
1. Accept a daily report PDF exported from Procore
2. Store the raw file and metadata (tenant, project, subcontractor)
3. Publish an SQS message for processing
4. Extract structured elements (weather, manpower, work areas, notes)
5. Store extracted structured data with links back to the original evidence
6. Include at least one basic test

## Exercise Context

The following choices establish the context for this coding exercise.

### Database

MongoDB with Mongoose.

### File Storage

S3-compatible storage using LocalStack for local development.

### PDF Extraction

Hybrid approach using pdf-parse for text extraction and an LLM for structured
data extraction.

**Note:** In the architecture proposal (Part 1), LLMs are used only at the
final synthesis stage as explanatory and navigational tools—not for upstream
analysis or data extraction. The use of LLM-based extraction in this exercise
is solely to facilitate the coding demonstration.

### Message Queue

ElasticMQ (SQS-compatible).

### Project Structure

Domain-driven modules with co-located unit tests and separate e2e tests:

```
src/
├── ingestion/          # File upload & storage
├── extraction/         # PDF parsing & LLM extraction
├── messaging/          # Queue publishing
└── shared/             # Common utilities, entities
test/
└── *.e2e-spec.ts       # E2E tests
```

## Implementation

See [daily-report-service/README.md](daily-report-service/README.md) for setup
instructions, design decisions, and documentation.
