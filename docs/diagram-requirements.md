# Diagram And Architecture Requirements

Provide diagrams that explain your implementation and your proposed production direction.

You may use Mermaid, draw.io, Excalidraw, PlantUML, or another clear format.

Every diagram shall be in a separate file.

## Required Views

### 1. System Architecture View

Show the main runtime components of your solution, it is up to you if you use one general diagram or split it into 3.

Include at minimum:

- client or caller entry points (REST callers, WebSocket clients)
- AWS services used (if not aws versed use what you know equivalent and translate to aws)
- NestJS service boundary
- REST surface
- WebSocket surface
- polling or monitoring worker or service boundary (leaderboard cache rehydration, `/health` polling)
- db storage (PostgreSQL source of truth, Redis cache)
- any background processing or asynchronous handling you introduce (Redis pub/sub fan-out, one-shot migration job, boot-time rehydration)

### 2. REST Data Flow Zoomed View

Show the end-to-end flow for match submission, rank computation, persistence, and leaderboard retrieval.

### 3. WebSocket Data Flow Zoomed View

Show how a local client connects and how events are produced and delivered.

### 4. Polling And Monitoring Data Flow Zoomed View

Show how the leaderboard cache is rehydrated from Postgres - queried, normalized, stored, and deduplicated - and how replica health is polled and turned into orchestration/alert events.

## What We Expect To See

Your diagrams should make it possible to understand:

- where validation happens
- where business logic is used
- where persistence happens
- where asynchronous behavior exists
- where trust boundaries exist

Do not submit generic stock architecture. Show the design you actually built and the production target you actually recommend.
