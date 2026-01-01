# Survival Chaos Statistics Backend & Replay Parser

Backend service for parsing game replays and providing aggregated statistical analytics through an API.

The system extracts structured data from replay files, stores it in a relational database, and exposes analytical endpoints for further consumption by external services or frontend applications.

## Features

- **Replay parsing**
  - Extraction of match, player, bonus, and timing data
  - Validation and normalization of replay contents
  - Support for background and scheduled parsing jobs

- **Statistics storage**
  - Normalized relational data model
  - Optimized queries for analytical workloads

- **Analytics API**
  - Win rate calculations
  - Match duration statistics (average, median, percentiles)
  - Bonus-based and mode-based aggregations
  - Flexible filtering by date ranges and parameters

- **Background processing**
  - Scheduled replay ingestion
  - Periodic recalculation of aggregates

## Technology Stack

- **Node.js**
- **NestJS**
- **Prisma**
- **PostgreSQL**
- **Docker / Docker Compose**
- **Kysely** (for analytical SQL queries, if applicable)
- **Cron jobs** for scheduled tasks

## High-Level Architecture

External data provider(s) → Replay files → Parser → Database → Analytics Service → API

- The parser is responsible only for replay decoding and validation
- The backend service handles persistence and analytics
- Business logic is intentionally kept out of the frontend

## Installation

### Requirements

- Node.js >= 18
- Docker
- PostgreSQL (local or containerized)

### Setup

```bash
git clone https://github.com/BogdanTretyakov/sc-statistic-backend.git
cd sc-statistic-backend
yarn install

```

### Environment

```bash

cp .env.example .env
docker-compose -f docker-compose.dev.yml up -d
```

### Database Migrations

```bash
yarn prisma migrate dev
```

### Running the Service

```bash
yarn start:dev
```

## Usage

### Game ID's provider

Service used `wikidata.service` for getting data about game id's. Check out typing for yours implements or just use my public repo for getting game data

### Admin panel

There is admin panel at [localhost:4000/admin](localhost:4000/admin). For replay parsing and analytics working you MUST specify wiki data key for every unique map version

### Data provider

Data from external providers coming in 3 steps:

1. `fetcher.service` get lists of matches and store match meta and replay url
1. `mapper.service` downloads replay binary file
1. `replay.service` parsing downloaded replays, writing parsed data and cleans up garbage

All tasks doing asynchronously by cron jobs. For adding new providers just implement needed external provider at first two services

### API

Check out `analytic.controller`. There is no OpenAPI or some same API Schemas.

## License

WTFPL
