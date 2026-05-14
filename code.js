// ============================================================
// CONFIG
// ============================================================
const CALENDAR_ID   = '[Get calendar ID from Google Calendar]';
const BATCH_SIZE    = 50;    // Google allows up to 50 requests per batch call
const REQUEST_DELAY = 100;   // ms between batch calls to avoid rate limiting

// ============================================================
// MAIN
// ============================================================
function deleteDuplicateEvents() {
  const START = new Date();
  const END   = new Date();
  END.setMonth(END.getMonth() + 1);

  Logger.log('Fetching events...');
  const events = fetchAllEvents(START, END);
  Logger.log(`Total events fetched: ${events.length}`);

  // Group by title + date
  const grouped = {};
  for (const event of events) {
    const title = event.summary || '(no title)';
    const date  = (event.start.date || event.start.dateTime || '').substring(0, 10);
    const key   = `${title}||${date}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(event.id);
  }

  // Collect IDs to delete (all but the first of each group)
  const toDelete = [];
  for (const [key, ids] of Object.entries(grouped)) {
    if (ids.length <= 1) continue;
    Logger.log(`"${key.split('||')[0]}" on ${key.split('||')[1]}: ${ids.length} copies, deleting ${ids.length - 1}`);
    toDelete.push(...ids.slice(1));
  }

  Logger.log(`Total duplicates to delete: ${toDelete.length}`);

  if (toDelete.length === 0) {
    Logger.log('No duplicates found. All clean!');
    return;
  }

  // Delete in batches
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE);
    batchDelete(batch);
    deleted += batch.length;
    Logger.log(`Deleted ${deleted} / ${toDelete.length}...`);
    Utilities.sleep(REQUEST_DELAY);
  }

  Logger.log(`Done! Deleted ${deleted} duplicate events.`);
}

// ============================================================
// Fetch ALL events via paginated Calendar REST API calls
// ============================================================
function fetchAllEvents(start, end) {
  const token = ScriptApp.getOAuthToken();
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;
  
  let allEvents = [];
  let pageToken = null;

  do {
    let url = `${baseUrl}?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&maxResults=2500&singleEvents=true`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true
    });

    const data = JSON.parse(response.getContentText());

    if (data.error) {
      Logger.log(`API error: ${JSON.stringify(data.error)}`);
      break;
    }

    allEvents = allEvents.concat(data.items || []);
    pageToken = data.nextPageToken || null;

    Logger.log(`Fetched ${allEvents.length} events so far...`);
    if (pageToken) Utilities.sleep(REQUEST_DELAY);

  } while (pageToken);

  return allEvents;
}

// ============================================================
// Batch delete up to 50 events in a single HTTP call
// ============================================================
function batchDelete(eventIds) {
  const token    = encodeURIComponent(ScriptApp.getOAuthToken());
  const boundary = 'batch_boundary';
  
  let body = '';
  for (const id of eventIds) {
    body += `--${boundary}\r\n`;
    body += `Content-Type: application/http\r\n\r\n`;
    body += `DELETE https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${id}\r\n`;
    body += `Authorization: Bearer ${decodeURIComponent(token)}\r\n\r\n`;
  }
  body += `--${boundary}--`;

  UrlFetchApp.fetch('https://www.googleapis.com/batch/calendar/v3', {
    method: 'post',
    contentType: `multipart/mixed; boundary=${boundary}`,
    headers: { Authorization: `Bearer ${decodeURIComponent(token)}` },
    payload: body,
    muteHttpExceptions: true
  });
}
