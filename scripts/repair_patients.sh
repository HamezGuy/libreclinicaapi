#!/bin/bash
API="http://localhost:3000/api"

printf '{"username":"jamesgui111","password":"jamesgui111"}' > /tmp/login.json
echo "=== Logging in ==="
LOGIN_RESP=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d @/tmp/login.json)
echo "Login resp: ${LOGIN_RESP:0:200}"
TOKEN=$(echo "$LOGIN_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || echo "")
echo "Token length: ${#TOKEN}"

if [ ${#TOKEN} -lt 10 ]; then
  echo "Login with jamesgui111 failed, trying admin..."
  printf '{"username":"admin","password":"admin"}' > /tmp/login.json
  LOGIN_RESP=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d @/tmp/login.json)
  echo "Admin login resp: ${LOGIN_RESP:0:200}"
  TOKEN=$(echo "$LOGIN_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || echo "")
  echo "Token length: ${#TOKEN}"
fi

if [ ${#TOKEN} -lt 10 ]; then
  echo "ERROR: All logins failed. Listing users..."
  docker exec libreclinica_db psql -U libreclinica -d libreclinica -c "SELECT user_id, user_name, first_name, last_name FROM user_account WHERE status_id=1 LIMIT 10;"
  exit 1
fi

echo ""
echo "=== Repairing all patients ==="
for SID in 25 26 27; do
  echo "--- Subject $SID ---"
  RESULT=$(curl -s -X POST "$API/events/verify/subject/$SID/repair" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" 2>&1)
  echo "  $RESULT"
done

echo ""
echo "=== Checking snapshot counts ==="
docker exec libreclinica_db psql -U libreclinica -d libreclinica -c "
SELECT ss.study_subject_id, ss.label,
  (SELECT COUNT(*) FROM event_crf ec INNER JOIN study_event se ON ec.study_event_id = se.study_event_id WHERE se.study_subject_id = ss.study_subject_id) AS event_crfs,
  (SELECT COUNT(*) FROM patient_event_form pef WHERE pef.study_subject_id = ss.study_subject_id) AS snapshots
FROM study_subject ss WHERE ss.status_id NOT IN (5,7) ORDER BY ss.study_subject_id;
"

echo ""
echo "=== Done ==="
rm -f /tmp/login.json
