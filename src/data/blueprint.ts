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
               (Master + Read Replicas)             (Session, Token Blocklist, SMS)
\`\`\`

### 1.2 Component Responsibilities
*   **Frontend (React + Vite + Tailwind CSS):** A lightweight, responsive Single Page Application (SPA) optimized for low-bandwidth mobile networks in Kenya (Edge/3G). It uses aggressive client-side caching via LocalStorage and IndexedDB.
*   **Backend (Python Django + DRF):** A secure, robust, enterprise-grade REST API utilizing Python 3.12 and Django. Handles complex business logic, transactional consistency, PDF generation, and external integration hooks.
*   **Database (PostgreSQL 16):** Houses relational models including complex constraint checks for member accounts, shares, loans, and transaction history.
*   **Caching & Queue Layer (Redis + Celery):** Offloads long-running tasks like M-Pesa IPN validation, daily financial report generation, and SMS notifications (via Africa's Talking API).`
  },
  {
    id: 'database',
    title: '2. Database Schema',
    subtitle: 'PostgreSQL Relational schema optimized for audit trails',
    content: `### 2.1 Database Naming Conventions
*   **Tables:** Lowercase snake_case pluralized (e.g., \`sacco_members\`, \`mpesa_transactions\`).
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
    ref_code VARCHAR(50) UNIQUE NOT NULL, -- M-Pesa Transaction ID (e.g. QE93FD82H1) or Voucher Code
    member_id UUID REFERENCES sacco_members(id) ON DELETE RESTRICT,
    vehicle_id UUID REFERENCES sacco_vehicles(id) ON DELETE RESTRICT,
    type VARCHAR(10) NOT NULL CHECK (type IN ('Credit', 'Debit')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('Daily Contribution', 'Registration Fee', 'Management Fee', 'Office Expenses', 'Petty Cash', 'Penalty')),
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
    subtitle: 'Secure REST endpoints with stateless JWT authentication',
    content: `### 3.1 Authentication Workflow
Security is implemented using short-lived Stateless JSON Web Tokens (JWT) combined with Secure, HttpOnly Cookies for token storage to prevent Cross-Site Scripting (XSS) and Session hijacking.

1.  **Request Login:** \`POST /api/v1/auth/login/\` with email and password.
2.  **Issue Token:** Server returns a short-lived access token (expires in 15 mins) and sets a HttpOnly, Secure, SameSite=Strict cookie with a refresh token (expires in 7 days).
3.  **Authorization:** Frontend includes access token in Authorization Header: \`Bearer <access_token>\`.
4.  **Token Refresh:** When access token expires, client calls \`POST /api/v1/auth/token/refresh/\` sending the Refresh Cookie.

### 3.2 Endpoint Architecture
All endpoints are strictly versioned: \`/api/v1/\`.

| Endpoint | Method | Role Allowed | Description |
| :--- | :--- | :--- | :--- |
| \`/auth/login/\` | POST | Anonymous | Authenticate user, obtain JWT |
| \`/members/\` | GET | All staff | List and search registered members |
| \`/members/\` | POST | Chairman, Secretary | Register a new member |
| \`/vehicles/\` | GET | All staff | List and search Matatus |
| \`/vehicles/\` | POST | Chairman, Secretary | Register a new vehicle |
| \`/transactions/\` | GET | All staff | Browse immutable transaction ledger |
| \`/transactions/\` | POST | Treasurer | Record daily contribution / M-Pesa code |
| \`/reports/summary/\` | GET | All staff | Get summary stats, targets |
| \`/reports/pdf/\` | GET | Chairman, Treasurer | Generate signed PDF financial ledger export |

### 3.3 Role-Based Permissions matrix
*   **Treasurer:** Full control over financial accounting, M-Pesa reconciliation, and daily cash logging.
*   **Secretary:** Owns registrations, contact details updating, minutes writing, and agenda creation.
*   **Chairman:** Ultimate Sacco supervisor, approves loans, reads audited statements, updates platform settings.
*   **Auditor:** Read-only access to all ledgers, reporting metrics, and validation logs.`
  },
  {
    id: 'security',
    title: '4. Security & Compliance Plan',
    subtitle: 'Fulfilling strict CBK Sacco guidelines and M-Pesa API safety',
    content: `### 4.1 Data Security & Privacy
Matatu Saccos process sensitive financial information. Compliance with the Central Bank of Kenya (CBK) and the Kenya Data Protection Act (ODPC) is native:

*   **Encryption at Rest:** Standard PostgreSQL storage volumes encrypted using AES-256.
*   **Encryption in Transit:** Dynamic HTTPS (TLS 1.3) enforced for all browser interfaces.
*   **Audit Logging:** Every user action (logins, exports, registrations) logged into an immutable database journal with IP address, user agent, and timestamp.
*   **Input Sanitization:** All forms enforce strict type checks, custom XSS protection middleware, and SQL injection prevention via Django ORM parameterized queries.

### 4.2 M-Pesa IPN Gateway Integration Security
When integrating the Safaricom M-Pesa Daraja API (C2B or STK Push):
1.  **IP Whitelisting:** Sacco endpoints only accept callback payloads from verified Safaricom IP ranges.
2.  **Signature Matching:** Secure signatures inside Safaricom headers verified using public certificates.
3.  **Ref Code Idempotency:** Financial Ledger enforces a strict unique constraint on \`ref_code\`. Safaricom callback attempts with repeated Transaction IDs are processed exactly once.`
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
*   **Phase 1 (Current Core):** Role-based Authentication, Members Registry, Vehicle Fleets, M-Pesa transactions recording, Daily aggregates, PDF summaries.
*   **Phase 2 (Savings & Shares):** Integration of shares ledger, interest calculators, custom withdraw vouchers, and passive SMS balance check systems.
*   **Phase 3 (Mobile Loan Matrix):** Loan application pipelines, automated credit scoring based on historic daily contributions, guarantor lockups, and auto-disbursal API.
*   **Phase 4 (AI Integration & OCR):** Deep optical character recognition (OCR) of paper cash receipts, automated dashboard forecasting, and Gemini voice assistant for non-technical members.

### 6.2 Git Branching Strategy
We enforce strict trunk-based development with short-lived feature branches:
*   \`main\`: Always deployable production code.
*   \`staging\`: Pre-release testing, linked to continuous integration (CI) servers.
*   \`feature/*\`: Local developer branches branched from \`main\`. Merged via Peer-Reviewed Pull Requests (PRs) passing automated unit tests.`
  }
];
