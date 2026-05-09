UPDATE users
SET email = 'local@open-mission-control.invalid'
WHERE lower(email) = 'owner@mission.local'
  AND NOT EXISTS (
    SELECT 1
    FROM users existing_user
    WHERE lower(existing_user.email) = 'local@open-mission-control.invalid'
  );
