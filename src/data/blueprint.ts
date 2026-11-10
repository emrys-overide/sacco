export interface BlueprintSection {
  id: string;
  title: string;
  subtitle: string;
  content: string;
}

export const blueprintSections: BlueprintSection[] = [
  {
    id: 'architecture',
    title: '1. System Architecture',
    subtitle: 'High-level structure designed for high availability & low latency',
    content: `### 1.1 Multi-Tier Cloud Architecture
The Sacco Management System is built using a modern, scalable multi-tier architecture designed to support thousands of active vehicles, drivers, and committee members:

\`\`\`
   [ Mobile Browsers ]       [ Desktop Browsers ]
            |                         |
            +------------+------------+
                         | (HTTPS / WSS)
                         v
                [ NGINX Reverse Proxy ]
                         |
      +------------------+------------------+
      | (Static Assets)                     | (API Requests)
      v                                     v
[ Amazon S3 / CDN ]             [ Django REST Backend ] (Stateless Gunicorn)
                                            |
                         +------------------+------------------+
                         |                                     |
                         v                                     v
               [ PostgreSQL Database ]                   [ Redis Cache ]
               (Master + Read Replicas)             (Session, Token Blocklist)
\`\`\`

### 1.2 Component Responsibilities
*   **Frontend (React + Vite + Tailwind CSS):** A lightweight, responsive Single Page Application (SPA) optimized for low-bandwidth mobile networks in Kenya (Edge/3G). It uses aggressive client-side caching via LocalStorage and IndexedDB.
*   **Backend (Python Django + DRF):** A secure, robust, enterprise-grade REST API utilizing Python 3.12 and Django. Handles complex business logic, transactional consistency, PDF generation, and external integration hooks.
*   **Database (PostgreSQL 16):** Houses relational models including complex constraint checks for member accounts, shares, loans, and transaction history.
*   **Caching & Queue Layer (Redis + Celery):** Offloads long-running tasks like Co-op Bank B2B event review and daily financial report generation.`
  },
  {
    id: 'database',
    title: '2. Database Schema',
    subtitle: 'PostgreSQL Relational schema optimized for audit trails',
    content: `### 2.1 Database Naming Conventions
*   **Tables:** Lowercase snake_case pluralized (e.g., \`sacco_members\`, \`coop_bank_ipn_events\`).
*   **Columns:** Lowercase snake_case singular (e.g., \`id\`, \`plate_number\`, \`created_at\`).
*   **Primary Keys:** Named exactly \`id\` as a UUIDv4 to prevent sequential ID guessing.
*   **Foreign Keys:** Suffix with \`_id\` referencing parent table (e.g., \`owner_id\` references \`sacco_members(id)\`).

### 2.2 Entity-Relationship Schema (DDL Blueprint)
The database structure enforces absolute mathematical balances to ensure audit health:

\`\`\`sql
-- Users and Sacco Staff
CREATE TABLE sacco_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('Chairman', 'Secretary', 'Treasurer', 'Auditor')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Members (Vehicle Owners and Drivers)
CREATE TABLE sacco_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    id_number VARCHAR(20) UNIQUE NOT NULL,
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Active', 'Inactive', 'Pending')),
    total_shares NUMERIC(15, 2) DEFAULT 0.00,
    total_savings NUMERIC(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Vehicles
CREATE TABLE sacco_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate_number VARCHAR(12) UNIQUE NOT NULL, -- e.g. "KCJ 402X"
    owner_id UUID NOT NULL REFERENCES sacco_members(id) ON DELETE RESTRICT,
    driver_name VARCHAR(150) NOT NULL,
    driver_phone VARCHAR(15) NOT NULL,
    route_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Maintenance', 'Suspended')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Financial Transactions (Immutable Double-Entry Ledger)
CREATE TABLE financial_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref_code VARCHAR(50) UNIQUE NOT NULL, -- Co-op Bank transaction ID, bank reference, or voucher code
    member_id UUID REFERENCES sacco_members(id) ON DELETE RESTRICT,
    vehicle_id UUID REFERENCES sacco_vehicles(id) ON DELETE RESTRICT,
    type VARCHAR(10) NOT NULL CHECK (type IN ('Credit', 'Debit')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('Daily Contribution', 'Savings Contribution', 'Registration Fee', 'Management Fee', 'Office Expenses', 'Petty Cash', 'Penalty')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    description TEXT,
    recorded_by UUID NOT NULL REFERENCES sacco_users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Future Loan Ledger Placeholder
CREATE TABLE sacco_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES sacco_members(id),
    principal_amount NUMERIC(12, 2) NOT NULL,
    balance_amount NUMERIC(12, 2) NOT NULL,
    interest_rate NUMERIC(5, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'Approved',
    due_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
\`\`\`

### 2.3 Relational Rules
1.  **Immutability:** Financial transaction records cannot be updated or deleted. To correct errors, a reversing ledger entry must be created with a distinct reference code.
2.  **Referential Integrity:** Users/Members cannot be deleted if active financial records or vehicles refer to them (\`ON DELETE RESTRICT\`).`
  },
  {
    id: 'api',
    title: '3. API & Auth Strategy',
    subtitle: 'Secure REST endpoints with signed bearer-session authentication',
    content: `### 3.1 Authentication Workflow
The current application uses signed JSON Web Tokens (JWTs) in the Authorization header. The browser holds the token only in the active application session; it is not stored as a persistent browser cookie or local-storage value. The server validates the signature, issuer, audience, expiry, account status, and role on every protected request.

1.  **Request login:** \`POST /api/auth/login\` with a registered email or phone and password.
2.  **Issue session:** The server returns a signed bearer token. The configured maximum lifetime is eight hours by default, and the server rejects a session after one hour without activity.
3.  **Authorization:** The frontend includes the token in the Authorization header: \`Bearer <token>\`.
4.  **Step-up controls:** The SACCO can require an authenticator-app code for officers. A Chairman-issued temporary password must be changed before the account can access SACCO records.

### 3.2 Endpoint Architecture
Protected endpoints are under \`/api/\`; the server is the authority for every role check.

| Endpoint | Method | Role Allowed | Description |
| :--- | :--- | :--- | :--- |
| \`/api/auth/login\` | POST | Anonymous | Authenticate an existing user and obtain a bearer session |
| \`/api/members\` | GET | Authorised roles | List the permitted member scope |
| \`/api/members\` | POST | Chairman, Secretary | Register a new member |
| \`/api/vehicles\` | GET | Authorised roles | List the permitted vehicle scope |
| \`/api/vehicles\` | POST | Chairman, Secretary | Register a new vehicle |
| \`/api/transactions\` | GET | Authorised roles | Browse the permitted ledger scope |
| \`/api/transactions\` | POST | Chairman, Treasurer, Accountant | Record an authorised ledger entry |
| \`/api/loans\` | GET/POST | Role-dependent | Review or submit SACCO loan workflow records |
| \`/api/member-portal\` | GET | Member | View only the authenticated member's own information |

### 3.3 Role-Based Permissions matrix
*   **Treasurer:** Full control over financial accounting, Co-op Bank event review, and daily cash logging.
*   **Secretary:** Owns registrations, contact details updating, minutes writing, and agenda creation.
*   **Chairman:** Ultimate Sacco supervisor, approves loans, reads audited statements, updates platform settings.
*   **Auditor:** Read-only access to all ledgers, reporting metrics, and validation logs.`
  },
  {
    id: 'security',
    title: '4. Security & Compliance Plan',
    subtitle: 'Practical safeguards and production controls for SACCO data',
    content: `### 4.1 Data Security & Privacy
Matatu Saccos process sensitive personal and financial information. The application includes security controls, but formal legal or regulatory compliance needs a separate SACCO review and cannot be claimed from software alone.

*   **Transport and browser protections:** Production is intended to run behind HTTPS with a restrictive Content Security Policy, frame blocking, no-store API responses, and security headers.
*   **Data access:** Every protected request re-checks the signed session and server-side role permission. Members are scoped to their own record.
*   **Audit logging:** PostgreSQL deployments record important security and operational actions with a timestamp, actor, and request context.
*   **Input handling:** Forms apply validation, JSON bodies are size-limited, and PostgreSQL queries use parameterized values. The application is a Node/Express service, not a Django application.
*   **Operational controls:** Keep secrets only in the host secret store, use individual accounts, enable officer authenticator codes for production, and keep backups outside the hosting filesystem.

### 4.2 Co-op Bank B2B Event Integration Security
When integrating Co-op Bank Core Banking Event Notifications:
1.  **HTTPS and authentication:** The registered endpoint accepts only the configured Bearer token or Basic credentials; secrets are stored only on the server.
2.  **Account allow-list:** Events are accepted only for authorised full Co-op account numbers and expected currency.
3.  **Transaction ID idempotency:** The durable inbox has a unique \`transaction_id\`; repeated bank notifications receive a successful response without creating a duplicate record.
4.  **Review before posting:** Credit and debit events are recorded as pending review. A bank event is never automatically treated as member income or posted to the ledger.`
  },
  {
    id: 'scaling',
    title: '5. Scaling & Deployment',
    subtitle: 'Dockerized microservices engineered to support thousands of active members',
    content: `### 5.1 System Architecture Deployment Blueprint
The system is fully containerized using Docker and deployed behind an Nginx Reverse Proxy with automated Let's Encrypt SSL certificates.

\`\`\`yaml
# docker-compose.prod.yml
version: '3.8'
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certbot/conf:/etc/letsencrypt
  backend:
    build: ./backend
    environment:
      - DATABASE_URL=postgresql://sacco_user:secure_pwd@db:5432/sacco_prod
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - db
      - redis
  frontend:
    image: nginx:alpine
    volumes:
      - ./frontend/dist:/usr/share/nginx/html
  db:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
\`\`\`

### 5.2 Scaling Path
1.  **Caching layer:** Cache Member Directories and static lists inside Redis for 6 hours, clearing them immediately on mutation.
2.  **Database Partitioning:** When transaction history reaches >1 million records, partition the \`financial_ledger\` table by year.
3.  **Read-Write Separation:** Introduce PgBouncer connection pooling and direct all reporting query read actions to read-only replicas.`
  },
  {
    id: 'roadmap',
    title: '6. Implementation Roadmap',
    subtitle: 'Agile phases moving from foundation to full financial OS',
    content: `### 6.1 Phase Breakdown
*   **Phase 1 (Current Core):** Role-based Authentication, Members Registry, Vehicle Fleets, Co-op Bank event recording, Daily aggregates, PDF summaries.
*   **Phase 2 (Savings & Shares):** Integration of shares ledger, interest calculators, and custom withdraw vouchers.
*   **Phase 3 (Mobile Loan Matrix):** Loan application pipelines, automated credit scoring based on historic daily contributions, guarantor lockups, and auto-disbursal API.
*   **Phase 4 (Reporting Automation):** Month-end close workflow, automated dashboard forecasting, Excel/PDF exports, and management review approvals.

### 6.2 Git Branching Strategy
We enforce strict trunk-based development with short-lived feature branches:
*   \`main\`: Always deployable production code.
*   \`staging\`: Pre-release testing, linked to continuous integration (CI) servers.
*   \`feature/*\`: Local developer branches branched from \`main\`. Merged via Peer-Reviewed Pull Requests (PRs) passing automated unit tests.`
  }
];
