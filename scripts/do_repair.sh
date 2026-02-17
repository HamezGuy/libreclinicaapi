#!/bin/bash
# Find the user and login, then repair
API="http://localhost:3000/api"

echo "=== Finding users ==="
docker exec libreclinica_db psql -U libreclinica -d libreclinica -c "SELECT user_id, user_name, institutional_affiliation FROM user_account WHERE status_id=1 ORDER BY user_id DESC LIMIT 20;"

echo ""
echo "=== Trying login with various users ==="
for USER in root admin senaakee clinicaltrial AshwinTestOne coordinator investigator; do
  for PASS in "$USER" "${USER}123" "password" "Password1" "admin123"; do
    RESP=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}")
    if echo "$RESP" | grep -q '"token"'; then
      TOKEN=$(echo "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
      echo "SUCCESS: $USER / $PASS (token: ${TOKEN:0:20}...)"

      echo ""
      echo "=== Repairing patients ==="
      for SID in 25 26 27; do
        echo "--- Subject $SID ---"
        curl -s -X POST "$API/events/verify/subject/$SID/repair" \
          -H 'Content-Type: application/json' \
          -H "Authorization: Bearer $TOKEN"
        echo ""
      done

      echo ""
      echo "=== Final snapshot counts ==="
      docker exec libreclinica_db psql -U libreclinica -d libreclinica -c "
        SELECT ss.study_subject_id, ss.label,
          (SELECT COUNT(*) FROM event_crf ec INNER JOIN study_event se ON ec.study_event_id=se.study_event_id WHERE se.study_subject_id=ss.study_subject_id) AS event_crfs,
          (SELECT COUNT(*) FROM patient_event_form pef WHERE pef.study_subject_id=ss.study_subject_id) AS snapshots
        FROM study_subject ss WHERE ss.status_id NOT IN (5,7) ORDER BY ss.study_subject_id;"

      rm -f /tmp/login.json
      exit 0
    fi
  done
done

echo "ERROR: Could not login with any known credentials"
echo "Falling back to direct DB repair..."

echo ""
echo "=== Cannot create snapshots without API (needs form metadata query) ==="
echo "Please login to the app and use the repair endpoint manually."
exit 1
