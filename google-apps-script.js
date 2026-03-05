/**
 * 강동종합사회복지관 경로식당 출석체크 시스템 v2
 * Google Apps Script 백엔드
 *
 * ── 설치 방법 ──────────────────────────────────
 * 1. Google Sheets 열기 (ID: 1_q3tiSGaM-F3NHg8Q0Z9dLhGyOghgNnb-ULnLVryn48)
 * 2. 확장 프로그램 → Apps Script
 * 3. 기존 코드 전체 삭제 후 이 파일 내용 붙여넣기
 * 4. 저장(Ctrl+S)
 * 5. 배포 → 새 배포 → 웹 앱
 *    · 실행 계정: 나
 *    · 액세스: 모든 사용자(익명 포함)
 * 6. 배포 URL → admin.html 설정탭에 입력
 * ──────────────────────────────────────────────
 */

const SH = {
  RECORDS : '출석기록',
  MEMBERS : '이용자명단',
  STATS   : '월별통계',
};

// ══ GET ══════════════════════════════════
function doGet(e) {
  const action = e?.parameter?.action || '';

  if (action === 'ping')
    return json({ status: 'ok', time: new Date().toISOString() });

  if (action === 'getMembers')
    return json({ members: readMembers() });

  if (action === 'getRecords') {
    const date = e.parameter.date || '';
    const month = e.parameter.month || '';
    const all = readRecords().filter(r =>
      (!date  || r.date === date) &&
      (!month || r.date.startsWith(month))
    );
    return json({ records: all });
  }

  if (action === 'getStats')
    return json({ stats: readStats(e.parameter.month || '') });

  return json({ status: 'ok' });
}

// ══ POST ═════════════════════════════════
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'addRecord') {
      appendRecord(body.data);
      updateStats(body.data.date);
      return json({ status: 'ok' });
    }
    if (action === 'addBatch') {
      (body.records || []).forEach(r => { appendRecord(r); updateStats(r.date); });
      return json({ status: 'ok', count: (body.records||[]).length });
    }
    if (action === 'syncAll') {
      if (body.members) writeMembers(body.members);
      if (body.records) writeRecords(body.records);
      rebuildStats();
      return json({ status: 'ok' });
    }
    if (action === 'syncMembers') {
      if (body.members) writeMembers(body.members);
      return json({ status: 'ok' });
    }
    return json({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return json({ status: 'error', message: err.toString() });
  }
}

// ══ 시트 헬퍼 ════════════════════════════
function getSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setBackground('#1a3a6b')
      .setFontColor('#f5c400')
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function sheetToObjects(sh, keys) {
  const rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .filter(r => r[0] !== '')
    .map(r => {
      const obj = {};
      keys.forEach((k, i) => { obj[k] = r[i] !== undefined ? String(r[i]) : ''; });
      return obj;
    });
}

// ══ 이용자 명단 ══════════════════════════
const MEMBER_KEYS = ['id','name','birth','gender','dong','addr','phone','type'];
const MEMBER_HDR  = ['번호','이름','생년월일','성별','관할동','주소','전화번호','보호유형'];

function readMembers() {
  return sheetToObjects(getSheet(SH.MEMBERS, MEMBER_HDR), MEMBER_KEYS);
}
function writeMembers(members) {
  const sh = getSheet(SH.MEMBERS, MEMBER_HDR);
  const last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
  if (!members.length) return;
  sh.getRange(2, 1, members.length, MEMBER_KEYS.length)
    .setValues(members.map(m => MEMBER_KEYS.map(k => m[k] || '')));
}

// ══ 출석 기록 ════════════════════════════
const RECORD_KEYS = ['id','date','time','name','phone','registered'];
const RECORD_HDR  = ['ID','날짜','시간','이름','전화번호','등록여부'];

function readRecords() {
  return sheetToObjects(getSheet(SH.RECORDS, RECORD_HDR), RECORD_KEYS).map(r => ({
    ...r, registered: r.registered === 'true' || r.registered === '등록',
  }));
}
function appendRecord(record) {
  if (readRecords().find(r => r.date === record.date && r.phone === record.phone)) return;
  getSheet(SH.RECORDS, RECORD_HDR).appendRow([
    record.id || Date.now(), record.date, record.time,
    record.name, record.phone, record.registered ? '등록' : '미등록',
  ]);
}
function writeRecords(records) {
  const sh = getSheet(SH.RECORDS, RECORD_HDR);
  const last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
  if (!records.length) return;
  sh.getRange(2, 1, records.length, 6).setValues(
    records.map(r => [r.id||'', r.date, r.time, r.name, r.phone, r.registered?'등록':'미등록'])
  );
}

// ══ 월별 통계 ════════════════════════════
const STATS_HDR = ['연월','연인원','실인원','운영일수','일평균','최다출석일','최다인원'];

function readStats(month) {
  const sh = getSheet(SH.STATS, STATS_HDR);
  return sh.getDataRange().getValues().slice(1)
    .filter(r => r[0] && (!month || String(r[0]).startsWith(month)))
    .map(r => ({ ym:r[0], total:r[1], unique:r[2], days:r[3], avg:r[4], maxDay:r[5], maxCount:r[6] }));
}

function updateStats(dateStr) {
  rebuildMonthStats(String(dateStr).slice(0, 7));
}

function rebuildStats() {
  const records = readRecords();
  const yms = [...new Set(records.map(r => String(r.date).slice(0,7)))];
  yms.forEach(ym => rebuildMonthStats(ym));
}

function rebuildMonthStats(ym) {
  const records = readRecords().filter(r => String(r.date).startsWith(ym));
  const byDay = {};
  records.forEach(r => { byDay[r.date] = (byDay[r.date]||[]).concat(r); });

  const total    = records.length;
  const uniq     = new Set(records.map(r=>r.phone)).size;
  const days     = Object.keys(byDay).length;
  const avg      = days ? (total/days).toFixed(1) : 0;
  const dayKeys  = Object.keys(byDay);
  const maxDay   = dayKeys.reduce((a,b) => byDay[a].length >= byDay[b].length ? a : b, dayKeys[0]||'');
  const maxCount = byDay[maxDay] ? byDay[maxDay].length : 0;

  const sh   = getSheet(SH.STATS, STATS_HDR);
  const data = sh.getDataRange().getValues();
  let idx = -1;
  for (let i=1; i<data.length; i++) if (String(data[i][0])===ym) { idx=i+1; break; }

  const row = [ym, total, uniq, days, avg, maxDay, maxCount];
  if (idx > 0) sh.getRange(idx, 1, 1, 7).setValues([row]);
  else sh.appendRow(row);
}

// ══ 응답 ═════════════════════════════════
function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
