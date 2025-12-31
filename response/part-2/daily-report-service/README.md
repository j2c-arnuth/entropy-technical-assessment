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
