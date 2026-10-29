CREATE TYPE user_role AS ENUM ('member', 'admin');
CREATE TYPE service_status AS ENUM ('active', 'inactive');
CREATE TYPE incident_status AS ENUM ('open', 'acknowledged', 'mitigating', 'resolved');
CREATE TYPE incident_severity AS ENUM ('P1', 'P2', 'P3', 'P4');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name varchar(120) NOT NULL,
  email varchar(320) NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  owner_team varchar(120) NOT NULL,
  criticality incident_severity NOT NULL DEFAULT 'P3',
  status service_status NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(200) NOT NULL,
  description text NOT NULL,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  severity incident_severity NOT NULL,
  status incident_status NOT NULL DEFAULT 'open',
  created_by uuid NOT NULL REFERENCES users(id),
  assignee_id uuid REFERENCES users(id),
  resolution_note text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(title)) > 0),
  CHECK (status <> 'resolved' OR (resolved_at IS NOT NULL AND resolution_note IS NOT NULL))
);

CREATE INDEX incidents_status_updated_idx ON incidents (status, updated_at DESC, id);
CREATE INDEX incidents_service_status_idx ON incidents (service_id, status, updated_at DESC);
CREATE INDEX incidents_assignee_status_idx ON incidents (assignee_id, status, updated_at DESC);

CREATE TABLE incident_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX incident_comments_timeline_idx ON incident_comments (incident_id, created_at, id);

CREATE TABLE incident_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  event_type varchar(60) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX incident_events_timeline_idx ON incident_events (incident_id, created_at, id);

