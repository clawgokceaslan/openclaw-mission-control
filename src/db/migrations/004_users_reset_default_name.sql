UPDATE users
SET name = ''
WHERE email = 'owner@mission.local' AND name IS NOT NULL;
