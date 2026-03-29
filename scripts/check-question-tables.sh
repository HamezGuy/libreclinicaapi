#!/bin/bash
# Check question_table data in the database
echo "=== Question table items in item table ==="
docker exec libreclinica_db psql -U libreclinica -d libreclinica -t -c \
  "SELECT count(*) FROM item WHERE description LIKE '%question_table%';"

echo "=== Item IDs and names ==="
docker exec libreclinica_db psql -U libreclinica -d libreclinica -t -c \
  "SELECT item_id, name FROM item WHERE description LIKE '%question_table%' LIMIT 20;"

echo "=== Patient snapshots with question_table ==="
docker exec libreclinica_db psql -U libreclinica -d libreclinica -t -c \
  "SELECT count(*) FROM patient_event_form WHERE form_structure::text LIKE '%question_table%';"

echo "=== Sample extended props for a question_table item ==="
docker exec libreclinica_db psql -U libreclinica -d libreclinica -t -c \
  "SELECT item_id, substring(description from '---EXTENDED_PROPS---(.{1,500})') FROM item WHERE description LIKE '%question_table%' LIMIT 3;"
