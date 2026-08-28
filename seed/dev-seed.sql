-- Local development seed only. Never run against the remote database.
--   npm run db:seed:local
-- Ids are fixed so the seed is idempotent and safe to re-run.

INSERT OR IGNORE INTO users (id, email, display_name, role)
VALUES ('11111111-1111-4111-8111-111111111111', 'pacardopaul18@gmail.com', 'Paul Pacardo', 'owner');

INSERT OR IGNORE INTO projects (id, name, phase, status, owner_id, next_milestone)
VALUES
  ('22222222-2222-4222-8222-222222222221', 'Sample CPG retainer', 'executing', 'on_track',
   '11111111-1111-4111-8111-111111111111', 'Q3 category review'),
  ('22222222-2222-4222-8222-222222222222', 'Sample brand launch', 'planning', 'at_risk',
   '11111111-1111-4111-8111-111111111111', 'Distributor shortlist');
