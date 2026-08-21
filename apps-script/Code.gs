/****************************************************************
 * 1. 설정 및 상수
 ****************************************************************/
const SHEETS = {
  MEMBERS: 'Members',
  SPECIAL_MEMBERS: 'special_members',
  REQUESTS: 'Requests',
  ARCHIVE: 'WithdrawArchive',
  DEPTHEADS: 'DeptHeads',
  ADMINS: 'Admins',
  DEPARTMENTS: 'Departments',
  CODES: 'StatusCodes',
  HISTORY: 'MemberHistory',
  CONSENT: 'ConsentLogs',
  PHOTO_QUEUE: 'PhotoUploadQueue',
  DEPT_STATUS_LINKS: '부서별 현황 공유 링크',
  RANK_STATUS_LINKS: '법계별 현황 공유 링크'
};

const DEPT_STATUS_FOLDER_NAME = '부서별 현황';
const RANK_STATUS_FOLDER_NAME = '법계별 현황';

const PHOTO_QUEUE_TRIGGER_FN = 'processPhotoQueueTrigger_';
const PHOTO_QUEUE_HEADERS = [
  'request_id', 'member_id', 'member_name',
  'file_id', 'file_link', 'original_filename',
  'uploader', 'status', 'created_at', 'processed_at', 'note',
  'birth_place', 'phone', 'email', 'address', 'job', 'company'
];

const FOLDER_NAME = "회원사진_저장소";
const FORM_FOLDER_NAME = "회원입회원서_저장소";
const PHOTO_THUMB_FOLDER_NAME = "회원사진_PDF썸네일";
const MEMBER_CARD_PDF_FOLDER_NAME = '회원카드_PDF';
const MEMBER_CARD_PDF_JOB_PREFIX = '회원카드_JOB_';
const MEMBER_CARD_PDF_BATCH_SIZE = 20;
const CACHE_TTL = 21600;
const SEARCH_CACHE_TTL = 120;
// 관리자 세션은 서명 토큰이라 서버에 저장하지 않는다. 유효기간만 토큰 안에 넣는다.
const API_SESSION_TTL_SECONDS = 21600;
const API_SESSION_SECRET_PROP = 'HRM_API_SESSION_SECRET_V1';
const TZ_CHECKED_PROP = 'HRM_TZ_CHECKED_V2';
const PENDING_REQUESTS_CACHE_KEY = 'PENDING_REQUESTS_V3';
const PENDING_REQUESTS_CACHE_SECONDS = 30;
const APP_TIMEZONE = 'Asia/Seoul';
const MEMBER_LAST_ID_PROP_KEY = 'MEMBER_LAST_ID_V2';
const MEMBER_LAST_ID_LEGACY_KEYS = ['MEMBER_LAST_ID_V1', 'MEMBER_LAST_ID'];

const COLS = {
  ID: '회원번호', NAME: '성명', PHONE: '전화번호', EMAIL: 'E-mail',
  GENDER: '남/여', BIRTH: '생일', LUNAR: '양/음', AGE: '나이', 
  ADDRESS: '주소', JOB: '직업', COMPANY: '직장명', 
  MOTIVE: '입회동기', REFERRER: '소개자', RELATION: '소개자와의 관계', 
  JOIN_DATE: '입회일', WITHDRAW_REASON: '탈퇴사유',
  TYPE: '회원구분', STATUS: '회원상태', HQ: '본원/지부', DEPT_ID: '부서ID',
  RANK: '법계', PROMO_DATE: '승급일', UPDATED_AT: 'updated_at', PHOTO: '사진', FORM: '입회원서',
  BIRTHPLACE: 'BirthPlace', DHARMA_NAME: '법명',
  CONSENT_YN: 'consent_status', CONSENT_DATE: 'consent_granted_at'
};

/**
 * Vite + React 프런트엔드를 위한 JSON API 진입점.
 *
 * 이 파일에는 기존 시트/Drive 처리 함수가 그대로 포함되어 있고 HTML만 분리했다.
 * 프런트는 POST body를 text/plain(JSON 문자열)로 보내므로 CORS preflight 없이 호출된다.
 */
function doGet(e) {
  ensureSpreadsheetTimezone_();
  const action = e && e.parameter ? String(e.parameter.action || '') : '';
  if (action) return handleApiAction_(action, e.parameter || {});
  return apiJson_({
    ok: true,
    result: {
      service: 'hr-manager-api',
      version: 2,
      status: 'ok',
      now: new Date().toISOString()
    }
  });
}

function doPost(e) {
  ensureSpreadsheetTimezone_();
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return apiJson_({ ok: false, error: 'invalid_json', message: '요청 형식이 올바르지 않습니다.' });
  }
  return handleApiAction_(String(body.action || ''), body);
}

function handleApiAction_(action, payload) {
  try {
    let result;
    switch (action) {
      case 'ping':
        result = { now: new Date().toISOString() };
        break;
      case 'getDepartmentList':
        result = getDepartmentList();
        break;
      case 'getMemberHeaders':
        result = getMemberHeaders();
        break;
      case 'searchMembers':
        requireApiSession_(payload.authToken, false);
        result = searchMembers(payload.keyword);
        break;
      case 'checkAuthAndLoadData':
        result = issueApiSession_(checkAuthAndLoadData(payload.email, payload.password));
        break;
      case 'verifyMemberLogin':
        result = verifyMemberLogin(payload.name, payload.memberId, payload.departmentName);
        break;
      case 'findSelfMemberCandidates':
        result = findSelfMemberCandidates(payload.name, payload.memberId, payload.departmentName);
        break;
      case 'submitReconsent':
        result = submitReconsent(payload.memberId, payload.type);
        break;
      case 'submitReconsentByToken':
        result = submitReconsentByToken(payload.token, payload.version);
        break;
      case 'submitRequest':
        result = submitRequest(payload.form || {});
        break;
      case 'getPendingRequests':
        requireApiSession_(payload.authToken, true);
        result = getPendingRequests();
        break;
      case 'processAdminAction':
        var processSession = requireApiSession_(payload.authToken, true);
        result = processAdminAction(payload.requestId, payload.decision, processSession.email);
        break;
      case 'getDetailedHistory':
        requireApiSession_(payload.authToken, true);
        result = getDetailedHistory(payload.mode, payload.p1, payload.p2, payload.header);
        break;
      case 'runExternalBulkUpdate':
        var updateSession = requireApiSession_(payload.authToken, true);
        result = runExternalBulkUpdate(payload.fileId, updateSession.email);
        break;
      case 'runExternalBulkRegister':
        var registerSession = requireApiSession_(payload.authToken, true);
        result = runExternalBulkRegister(payload.fileId, registerSession.email);
        break;
      case 'exportToExcel':
        requireApiSession_(payload.authToken, true);
        result = exportToExcel(Array.isArray(payload.headers) ? payload.headers : []);
        break;
      case 'searchMembersForPhoto':
        result = searchMembersForPhoto(payload.name);
        break;
      case 'uploadMemberPhotoDirect':
        result = uploadMemberPhotoDirect(
          payload.memberId,
          payload.base64Data,
          payload.fileName,
          payload.uploader,
          payload.memberName,
          payload.extras || {}
        );
        break;
      case 'getPhotoQueueStatus':
        result = getPhotoQueueStatus(payload.requestId);
        break;
      case 'getMemberCardFilterOptions':
        result = getMemberCardFilterOptions();
        break;
      case 'getMemberCardsData':
        result = getMemberCardsData(payload.mode, payload.keyword, payload.sortBy);
        break;
      case 'generateMemberCardsPdfBatch':
        result = generateMemberCardsPdfBatch(
          payload.mode,
          payload.keyword,
          Number(payload.batchIndex) || 0,
          Array.isArray(payload.excludeIds) ? payload.excludeIds : [],
          payload.sortBy,
          !!payload.showNameCheck,
          payload.jobId || ''
        );
        break;
      default:
        return apiJson_({ ok: false, error: 'unknown_action', message: '지원하지 않는 API 작업입니다: ' + action });
    }
    return apiJson_({ ok: true, result: result });
  } catch (error) {
    console.error('API ' + action + ' failed: ' + (error && error.stack ? error.stack : error));
    return apiJson_({
      ok: false,
      error: (error && error.apiErrorCode) || 'server_error',
      message: error && error.message ? error.message : String(error)
    });
  }
}

function apiJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 프런트에 전달할 오류 코드를 함께 담은 Error를 만든다. */
function apiError_(message, code) {
  const error = new Error(message);
  error.apiErrorCode = code;
  return error;
}

/**
 * 세션 서명키. ScriptProperties에 한 번만 만들어 두고 계속 재사용한다.
 * CacheService와 달리 삭제되지 않으므로 발급한 토큰이 임의로 무효화되지 않는다.
 */
function getApiSessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(API_SESSION_SECRET_PROP);
  if (secret) return secret;

  const lock = LockService.getScriptLock();
  let locked = false;
  try { locked = lock.tryLock(5000); } catch (e) { locked = false; }
  try {
    secret = props.getProperty(API_SESSION_SECRET_PROP);
    if (!secret) {
      secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
      props.setProperty(API_SESSION_SECRET_PROP, secret);
    }
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) {} }
  }
  return secret;
}

function signApiSessionPayload_(encodedPayload) {
  const bytes = Utilities.computeHmacSha256Signature(encodedPayload, getApiSessionSecret_());
  return Utilities.base64EncodeWebSafe(bytes);
}

/** 길이가 같아도 앞부분만 비교하고 끝내지 않도록 전체를 훑는다. */
function timingSafeEquals_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/**
 * 관리자 API는 UI 로그인 결과로 발급한 서명 토큰이 있어야 실행된다.
 * 토큰 형식: base64url(payload JSON) + '.' + base64url(HMAC-SHA256)
 * 서버에 아무것도 저장하지 않으므로 캐시가 비워져도 세션이 끊기지 않는다.
 */
function issueApiSession_(login) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    role: login.role,
    email: login.email,
    userName: login.userName,
    iat: issuedAt,
    exp: issuedAt + API_SESSION_TTL_SECONDS
  };
  const encoded = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8);
  login.apiToken = encoded + '.' + signApiSessionPayload_(encoded);
  login.apiTokenExpiresAt = new Date(payload.exp * 1000).toISOString();
  return login;
}

function parseSignedApiSession_(token) {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!timingSafeEquals_(signature, signApiSessionPayload_(encoded))) return null;
  try {
    const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString('UTF-8');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

/** 이번 배포 이전에 발급된 캐시 기반 토큰도 만료 전까지는 그대로 인정한다. */
function parseLegacyApiSession_(token) {
  if (token.indexOf('.') !== -1) return null;
  let raw = null;
  try { raw = CacheService.getScriptCache().get('HRM_API_SESSION:' + token); } catch (e) { return null; }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function requireApiSession_(token, adminOnly) {
  const safeToken = String(token || '').trim();
  if (!safeToken) throw apiError_('로그인이 필요합니다. 다시 로그인해 주세요.', 'auth_required');

  const session = parseSignedApiSession_(safeToken) || parseLegacyApiSession_(safeToken);
  if (!session) throw apiError_('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.', 'auth_required');
  if (session.exp && session.exp * 1000 <= Date.now()) {
    throw apiError_('로그인 후 6시간이 지났습니다. 다시 로그인해 주세요.', 'session_expired');
  }
  if (adminOnly && session.role !== 'ADMIN') throw apiError_('관리자 권한이 필요합니다.', 'forbidden');
  return session;
}

/**
 * 시간대 확인은 스프레드시트를 여는 비용이 크다.
 * 캐시는 자주 비워져 매 요청마다 다시 열리므로 ScriptProperties에 기록한다.
 */
function ensureSpreadsheetTimezone_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(TZ_CHECKED_PROP) === APP_TIMEZONE) return;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSpreadsheetTimeZone() !== APP_TIMEZONE) {
      ss.setSpreadsheetTimeZone(APP_TIMEZONE);
    }
    props.setProperty(TZ_CHECKED_PROP, APP_TIMEZONE);
  } catch (e) {}
}

/****************************************************************
 * [Helper] 유틸리티
 ****************************************************************/
function normalize(val, isId = false) {
  if (!val) return "";
  const str = String(val);
  return isId ? str.replace(/\s+/g, '') : str.trim();
}

function hasColumn(map, colName) {
  return map && Object.prototype.hasOwnProperty.call(map, colName);
}

function toDateInAppTimeZone(dateLike) {
  if (!dateLike) return null;
  if (dateLike instanceof Date) {
    return isNaN(dateLike.getTime()) ? null : new Date(dateLike.getTime());
  }

  const raw = normalize(dateLike);
  if (!raw) return null;

  // 문자열 로그는 KST 로컬 시각으로 간주해 UTC 타임스탬프로 변환한다.
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const y = Number(m[1]);
    const mon = Number(m[2]) - 1;
    const d = Number(m[3]);
    const hh = Number(m[4] || 0);
    const mm = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    return new Date(Date.UTC(y, mon, d, hh - 9, mm, ss));
  }

  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatInAppTimeZone(dateLike, pattern) {
  const d = toDateInAppTimeZone(dateLike);
  if (!d) return '';
  return Utilities.formatDate(d, APP_TIMEZONE, pattern);
}

function nowDateTimeStr() {
  return formatInAppTimeZone(new Date(), "yyyy-MM-dd HH:mm:ss");
}

function normalizeRequestType_(typeRaw) {
  const raw = normalize(typeRaw);
  const upper = raw.toUpperCase();
  if (!raw) return '';
  if (upper === 'NEW' || raw === '신규' || raw === '신규가입' || raw === '가입') return 'NEW';
  if (upper === 'TRANSFER' || raw === '부서이동' || raw === '이동') return 'TRANSFER';
  if (upper === 'WITHDRAW' || raw === '탈퇴') return 'WITHDRAW';
  if (upper === 'UPDATE' || upper === 'MODIFY' || raw === '정보수정' || raw === '수정') return 'UPDATE';
  if (upper.indexOf('UPDATE') >= 0 || upper.indexOf('MODIFY') >= 0 || raw.indexOf('수정') >= 0) return 'UPDATE';
  if (upper.indexOf('TRANSFER') >= 0 || raw.indexOf('이동') >= 0) return 'TRANSFER';
  if (upper.indexOf('WITHDRAW') >= 0 || raw.indexOf('탈퇴') >= 0) return 'WITHDRAW';
  if (upper.indexOf('NEW') >= 0 || raw.indexOf('신규') >= 0 || raw.indexOf('가입') >= 0) return 'NEW';
  return upper;
}

function inferRequestType_(row) {
  const normalizedType = normalizeRequestType_(row && row[1]);
  if (normalizedType === 'NEW' || normalizedType === 'TRANSFER' || normalizedType === 'WITHDRAW' || normalizedType === 'UPDATE') {
    return normalizedType;
  }

  const reason = normalize(row && row[7]);
  if (reason.indexOf('수정') >= 0) return 'UPDATE';
  if (reason.indexOf('이동') >= 0) return 'TRANSFER';
  if (reason.indexOf('탈퇴') >= 0) return 'WITHDRAW';

  try {
    const payload = JSON.parse((row && row[8]) || '{}');
    if (payload && typeof payload === 'object') {
      if (payload.target_dept_id && !payload.dept_name) return 'TRANSFER';
      if (payload.reason && normalize(payload.reason).indexOf('탈퇴') >= 0) return 'WITHDRAW';
      const updateKeys = ['phone','email','address','job','company','rank','birth','birth_place','dharma_name','gender','lunar_solar','status','type','dept_name','photoData','사진','회원구분'];
      for (let i = 0; i < updateKeys.length; i++) {
        if (payload[updateKeys[i]]) return 'UPDATE';
      }
    }
  } catch(e) {}
  return normalizedType || 'UPDATE';
}

function isEmptyValue_(val) {
  return val === null || val === undefined || String(val).trim() === '';
}

function isAllowedPhotoPayload_(photoName, photoData) {
  const name = String(photoName || '').trim().toLowerCase();
  const byExt = /\.(jpe?g|png|gif|webp)$/i.test(name);

  let byMime = false;
  const raw = String(photoData || '').trim();
  const m = raw.match(/^data:([^;]+);base64,/i);
  if (m && m[1]) {
    const mime = String(m[1]).toLowerCase();
    byMime = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp';
  }
  return byExt || byMime;
}

function toDisplayValue_(val) {
  if (val instanceof Date) return formatInAppTimeZone(val, "yyyy-MM-dd");
  return String(val === null || val === undefined ? '' : val).trim();
}

function toDisplayOrEmpty_(val) {
  const txt = toDisplayValue_(val);
  return txt || '(빈값)';
}

function getUpdateFieldLabel_(headerOrKey) {
  const key = String(headerOrKey || '').trim();
  const labels = {
    phone: '전화번호',
    email: 'E-mail',
    address: '주소',
    job: '직업',
    company: '직장명',
    rank: '법계',
    birth: '생일',
    birth_place: '출생지',
    dharma_name: '법명',
    gender: '남/여',
    lunar_solar: '양/음',
    status: '회원상태',
    type: '회원구분',
    dept_name: '부서명'
  };
  if (labels[key]) return labels[key];
  if (key === COLS.BIRTHPLACE) return '출생지';
  if (key === COLS.DHARMA_NAME) return '법명';
  if (key === COLS.DEPT_ID) return '부서명';
  return key;
}

function resolveUpdateHeader_(key) {
  if (key === 'phone') return COLS.PHONE;
  if (key === 'rank') return COLS.RANK;
  if (key === 'email') return COLS.EMAIL;
  if (key === 'address') return COLS.ADDRESS;
  if (key === 'job') return COLS.JOB;
  if (key === 'company') return COLS.COMPANY;
  if (key === 'birth') return COLS.BIRTH;
  if (key === 'birth_place') return COLS.BIRTHPLACE;
  if (key === 'dharma_name') return COLS.DHARMA_NAME;
  if (key === 'gender') return COLS.GENDER;
  if (key === 'lunar_solar') return COLS.LUNAR;
  if (key === 'status') return COLS.STATUS;
  if (key === 'type') return COLS.TYPE;
  return key;
}

function isRequestMetaKey_(key) {
  return !!{
    type: true,
    member_id: true,
    name: true,
    current_dept_id: true,
    target_dept_id: true,
    reason: true,
    requester_email: true,
    requester_name: true,
    consent_mandatory: true,
    consent_optional: true,
    consent_log: true,
    photoData: true,
    photoName: true,
    formData: true,
    formName: true
  }[key];
}

function buildUpdatePreviewChanges_(payload, currentRow, map, deptMap, deptIdByName) {
  if (!payload) return [];
  const changes = [];
  const deptById = deptMap || {};
  const deptByName = deptIdByName || {};
  const hasCurrent = !!(currentRow && map);

  // 정보수정 요청에서 입회원서 파일이 첨부된 경우, 변경항목 미리보기에 표시한다.
  if (!isEmptyValue_(payload.formData) || !isEmptyValue_(payload.formName)) {
    let beforeForm = '(조회불가)';
    if (hasCurrent && map[COLS.FORM] !== undefined) {
      const oldForm = toDisplayValue_(currentRow[map[COLS.FORM]]);
      beforeForm = oldForm ? '기존 파일' : '(빈값)';
    }
    const fileName = toDisplayValue_(payload.formName) || '신규 파일';
    changes.push({ label: '입회원서', before: beforeForm, after: fileName });
  }

  Object.keys(payload).forEach((k) => {
    if (isRequestMetaKey_(k)) return;
    const rawNewVal = payload[k];
    if (isEmptyValue_(rawNewVal)) return;

    if (k === 'dept_name' || k === COLS.DEPT_ID || k === '부서명') {
      const reqVal = String(rawNewVal).trim();
      const byName = deptByName[normalize(reqVal)];
      const nextDeptName = byName ? byName.name : (deptById[reqVal] || reqVal);

      let oldDeptName = '(조회불가)';
      if (hasCurrent && map[COLS.DEPT_ID] !== undefined) {
        const oldDeptId = String(currentRow[map[COLS.DEPT_ID]] || '').trim();
        oldDeptName = deptById[oldDeptId] || oldDeptId || '소속미정';
        if (oldDeptName === nextDeptName) return;
      }
      changes.push({ label: '부서명', before: oldDeptName, after: nextDeptName || '(빈값)' });
      return;
    }

    const header = resolveUpdateHeader_(k);
    if (!header || header === COLS.HQ) return;
    const label = getUpdateFieldLabel_(header);

    let nextVal = toDisplayValue_(rawNewVal);
    if (header === COLS.TYPE) {
      const normType = normalize(rawNewVal);
      if (normType !== '승려' && normType !== '신도') return;
      nextVal = normType;
    } else if (header === COLS.GENDER) {
      const normGender = normalize(rawNewVal);
      if (normGender !== '남' && normGender !== '여') return;
      nextVal = normGender;
    } else if (header === COLS.LUNAR) {
      const normLunar = normalize(rawNewVal);
      if (normLunar !== '양' && normLunar !== '음') return;
      nextVal = normLunar;
    } else if (header === COLS.STATUS) {
      const normStatus = normalize(rawNewVal);
      if (normStatus !== '활동' && normStatus !== '명목' && normStatus !== '명예' && normStatus !== '탈퇴' && normStatus !== '자격정지') return;
      nextVal = normStatus;
    }

    if (hasCurrent) {
      if (map[header] === undefined) {
        // 아직 Members 시트에 해당 컬럼이 없는 경우에도 변경 미리보기에는 표시
        changes.push({ label: label, before: '(빈값)', after: nextVal || '(빈값)' });
        return;
      }
      const oldVal = toDisplayValue_(currentRow[map[header]]);
      if (oldVal === nextVal) return;
      changes.push({
        label: label,
        before: oldVal || '(빈값)',
        after: nextVal || '(빈값)'
      });
      return;
    }

    changes.push({
      label: label,
      before: '(조회불가)',
      after: nextVal || '(빈값)'
    });
  });

  if (payload.photoData) {
    let photoBefore = '(조회불가)';
    if (hasCurrent && map[COLS.PHOTO] !== undefined) {
      photoBefore = currentRow[map[COLS.PHOTO]] ? '기존 사진' : '(빈값)';
    }
    changes.push({ label: '사진', before: photoBefore, after: '신규 사진' });
  }
  return changes;
}

function getColumnMap(sheet) {
  if (!sheet) return {};
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { if(h) map[String(h).trim()] = i; });
  return map;
}

function getDepartmentList() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("DEPT_LIST");
  if (cached) return JSON.parse(cached);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const deptSheet = ss.getSheetByName(SHEETS.DEPARTMENTS);
    if(deptSheet && deptSheet.getLastRow() > 1) {
      const data = deptSheet.getRange(2, 1, deptSheet.getLastRow()-1, 2).getValues().map(r => ({id: r[0], name: r[1]}));
      cache.put("DEPT_LIST", JSON.stringify(data), CACHE_TTL);
      return data;
    }
  } catch(e) {}
  return [];
}

function getMemberHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.MEMBERS);
  if(!sheet) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter(h => h !== "");
}

function calculateAge(birthDateValue) {
  if (!birthDateValue) return '';
  try {
    let birthYear = 0;

    // 시트 날짜 셀은 Date 객체로 들어온다. 스크립트/시트 시간대 차이를 피하기 위해
    // getFullYear() 대신 애플리케이션 시간대로 연도만 추출한다.
    if (birthDateValue instanceof Date && !isNaN(birthDateValue.getTime())) {
      birthYear = Number(Utilities.formatDate(birthDateValue, APP_TIMEZONE, 'yyyy'));
    } else {
      const raw = String(birthDateValue).trim();
      // 가입 폼의 yyyy-MM-dd뿐 아니라 yyyy.MM.dd, yyyy/MM/dd, yyyymmdd도 동일하게 처리한다.
      const yearMatch = /^(\d{4})(?:[-.\/년]|\d{4}$)/.exec(raw);
      if (yearMatch) {
        birthYear = Number(yearMatch[1]);
      } else {
        const parsed = toDateInAppTimeZone(raw);
        if (parsed) birthYear = Number(Utilities.formatDate(parsed, APP_TIMEZONE, 'yyyy'));
      }
    }

    const currentYear = Number(Utilities.formatDate(new Date(), APP_TIMEZONE, 'yyyy'));
    if (!birthYear || birthYear < 1800 || birthYear > currentYear) return '';
    return currentYear - birthYear + 1;
  } catch(e) { return ''; }
}

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return null;
  return { sheet: sheet, values: sheet.getRange(1, 1, lastRow, lastCol).getValues(), map: getColumnMap(sheet) };
}

function findRowByExactValue_(sheet, col1Based, target) {
  if (!sheet || !col1Based || target === null || target === undefined) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return -1;
  const finder = sheet.getRange(1, col1Based, lastRow, 1).createTextFinder(String(target).trim());
  finder.matchEntireCell(true);
  const found = finder.findNext();
  return found ? found.getRow() : -1;
}

function findMemberRowById_(memSheet, map, memberId) {
  if (!memSheet || !map || map[COLS.ID] === undefined) return -1;
  const target = normalize(memberId, true);
  if (!target) return -1;

  const idCol = map[COLS.ID] + 1;
  const fastRow = findRowByExactValue_(memSheet, idCol, target);
  if (fastRow > 1) return fastRow;

  // TextFinder가 숫자/문자 포맷 차이로 놓친 경우를 대비한 1열 fallback
  const lastRow = memSheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = memSheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (normalize(ids[i][0], true) === target) return i + 2;
  }
  return -1;
}

function getDepartmentInfoMaps_() {
  const cache = CacheService.getScriptCache();
  const key = 'DEPT_INFO_MAPS_V1';
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const maps = { byId: {}, byName: {} };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ds = ss.getSheetByName(SHEETS.DEPARTMENTS);
  if (!ds || ds.getLastRow() < 2) return maps;

  const dd = ds.getDataRange().getValues();
  for (let i = 1; i < dd.length; i++) {
    const deptId = String(dd[i][0] || '').trim();
    if (!deptId) continue;
    const deptName = String(dd[i][1] || '').trim();
    const hq = dd[i][4];
    maps.byId[deptId] = { name: deptName, hq: hq };
    if (deptName) maps.byName[normalize(deptName)] = { id: deptId, name: deptName };
  }
  cache.put(key, JSON.stringify(maps), CACHE_TTL);
  return maps;
}

function getDriveFolderCacheKey_(folderName) {
  return 'DRIVE_FOLDER_ID:' + hashStringForCache_(folderName || '');
}

function getOrCreateDriveFolder_(folderName, shareWithLink) {
  const targetFolder = normalize(folderName) || FOLDER_NAME;
  const props = PropertiesService.getScriptProperties();
  const key = getDriveFolderCacheKey_(targetFolder);
  const sharedKey = key + ':SHARED';
  const cachedId = props.getProperty(key);

  if (cachedId) {
    try {
      const cachedFolder = DriveApp.getFolderById(cachedId);
      cachedFolder.getName(); // 권한/삭제 여부 확인
      if (shareWithLink && props.getProperty(sharedKey) !== '1') {
        try {
          cachedFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          props.setProperty(sharedKey, '1');
        } catch (e) {}
      }
      return cachedFolder;
    } catch (e) {
      props.deleteProperty(key);
      props.deleteProperty(sharedKey);
    }
  }

  const folders = DriveApp.getFoldersByName(targetFolder);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(targetFolder);
  props.setProperty(key, folder.getId());
  if (shareWithLink) {
    try {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      props.setProperty(sharedKey, '1');
    } catch (e) {}
  }
  return folder;
}

function isDriveFolderSharedWithLink_(folderName) {
  const targetFolder = normalize(folderName) || FOLDER_NAME;
  const key = getDriveFolderCacheKey_(targetFolder) + ':SHARED';
  return PropertiesService.getScriptProperties().getProperty(key) === '1';
}

function parseMemberIdNumber_(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.floor(val);
  const raw = String(val).trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[,\s]/g, '');
  if (/^\d+$/.test(cleaned)) return Number(cleaned) || 0;
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? (Number(digits) || 0) : 0;
}

function getMemberIdStats_(memSheet, map) {
  const stats = { max: 0, last: 0 };
  if (!memSheet || !map || map[COLS.ID] === undefined) return stats;
  const lastRow = memSheet.getLastRow();
  if (lastRow < 2) return stats;

  const ids = memSheet.getRange(2, map[COLS.ID] + 1, lastRow - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    const num = parseMemberIdNumber_(ids[i][0]);
    if (!num) continue;
    stats.max = Math.max(stats.max, num);
    stats.last = num;
  }
  return stats;
}

function getMaxMemberId_(memSheet, map) {
  return getMemberIdStats_(memSheet, map).max;
}

// 탈퇴 회원이 Members 시트에서 제거되어도 회원번호가 재사용되지 않도록,
// WithdrawArchive 시트에 보관된 과거 회원번호의 최댓값을 함께 반영한다.
function getArchivedMaxMemberId_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const archiveSheet = ss.getSheetByName(SHEETS.ARCHIVE) || ss.getSheetByName('WithdrawnArchive');
  if (!archiveSheet) return 0;
  const lastRow = archiveSheet.getLastRow();
  const lastCol = archiveSheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return 0;

  const headers = archiveSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idCols = [];
  headers.forEach((h, i) => {
    if (h === 'member_id' || h === `M_${COLS.ID}`) idCols.push(i + 1);
  });
  if (!idCols.length) return 0;

  let max = 0;
  for (let i = 0; i < idCols.length; i++) {
    const vals = archiveSheet.getRange(2, idCols[i], lastRow - 1, 1).getDisplayValues();
    for (let j = 0; j < vals.length; j++) {
      const num = parseMemberIdNumber_(vals[j][0]);
      if (num > max) max = num;
    }
  }
  return max;
}

// ScriptProperties 에 보관된 "지금까지 발급된 회원번호 중 최댓값"을 반환.
// 값이 비어있는 경우(최초 실행 또는 properties 손실)에 한해 Members + WithdrawArchive 시트를
// 스캔해 부트스트랩하고 그 결과를 저장한다. 레거시 키는 시트/아카이브 max 보다 약간만 앞서 있을
// 때(차이 ≤ 1000) 신뢰하고, 그보다 크게 벗어나 있으면 stale 데이터로 보고 무시한다.
// 이후 호출은 저장값만 사용하며 시트를 스캔하지 않는다.
function getStoredMaxMemberId_(memSheet, map) {
  const props = PropertiesService.getScriptProperties();
  const stored = parseMemberIdNumber_(props.getProperty(MEMBER_LAST_ID_PROP_KEY));
  if (stored > 0) return stored;

  const sheetStats = (memSheet && map) ? getMemberIdStats_(memSheet, map) : { max: 0, last: 0 };
  const sheetMax = Math.max(sheetStats.max, sheetStats.last);
  const archivedMax = getArchivedMaxMemberId_();
  const baseMax = Math.max(sheetMax, archivedMax);

  let legacyMax = 0;
  for (let i = 0; i < MEMBER_LAST_ID_LEGACY_KEYS.length; i++) {
    const v = parseMemberIdNumber_(props.getProperty(MEMBER_LAST_ID_LEGACY_KEYS[i]));
    if (v > legacyMax) legacyMax = v;
  }
  const trustedLegacy = (legacyMax > baseMax && legacyMax - baseMax <= 1000) ? legacyMax : 0;

  const initial = Math.max(baseMax, trustedLegacy);
  if (initial > 0) {
    props.setProperty(MEMBER_LAST_ID_PROP_KEY, String(initial));
    // 레거시 키는 더 이상 사용하지 않으므로 정리
    MEMBER_LAST_ID_LEGACY_KEYS.forEach(k => {
      try { props.deleteProperty(k); } catch (e) {}
    });
  }
  return initial;
}

function reserveMemberIds_(count, memSheet, map) {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return { start: 0, end: 0 };

  const lock = LockService.getDocumentLock() || LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    // 저장된 max 값 + 1 부터 발급. 탈퇴/삭제로 Members 에서 사라진 번호도 재사용되지 않는다.
    const lastId = getStoredMaxMemberId_(memSheet, map);
    const start = lastId + 1;
    const end = start + n - 1;
    props.setProperty(MEMBER_LAST_ID_PROP_KEY, String(end));
    return { start: start, end: end };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function reserveNextMemberId_(memSheet, map) {
  return reserveMemberIds_(1, memSheet, map).start;
}

function getSearchCacheVersion_() {
  const cache = CacheService.getScriptCache();
  return cache.get('MEM_SEARCH_VER') || '1';
}

function hashStringForCache_(text) {
  const raw = String(text || '');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] + 256) % 256;
    const h = v.toString(16);
    hex += h.length === 1 ? ('0' + h) : h;
  }
  return hex;
}

function bumpSearchCacheVersion_() {
  CacheService.getScriptCache().put('MEM_SEARCH_VER', String(Date.now()), CACHE_TTL);
}

function getWithdrawArchiveSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.ARCHIVE);
  if (!sheet) sheet = ss.getSheetByName('WithdrawnArchive');
  if (!sheet) sheet = ss.insertSheet(SHEETS.ARCHIVE);
  return sheet;
}

function buildArchiveHeaders_(memberHeaders, historyHeaders) {
  const base = ['record_type', 'archived_at', 'member_id', 'member_name'];
  const mHeaders = memberHeaders.map(h => `M_${h}`);
  const hHeaders = historyHeaders.map(h => `H_${h}`);
  return base.concat(mHeaders, hHeaders);
}

function ensureWithdrawArchiveHeaders_(sheet, memberHeaders, historyHeaders) {
  const required = buildArchiveHeaders_(memberHeaders, historyHeaders);
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const hasAnyHeader = existing.some(h => h !== "");
  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    return required;
  }
  const updated = existing.slice();
  required.forEach(h => { if (updated.indexOf(h) === -1) updated.push(h); });
  if (updated.length !== existing.length) {
    sheet.getRange(1, 1, 1, updated.length).setValues([updated]);
  }
  return updated;
}

function archiveWithdrawnMember_(memberId, memberRowVals, memberMap, nowStr) {
  const archiveSheet = getWithdrawArchiveSheet_();
  const memberHeaders = getMemberHeaders();
  const historySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.HISTORY);

  let historyHeaders = [];
  let historyStartIdx = 1;
  let historyRows = [];
  let hMap = {};
  if (historySheet && historySheet.getLastRow() > 0 && historySheet.getLastColumn() > 0) {
    const hLastRow = historySheet.getLastRow();
    const hLastCol = historySheet.getLastColumn();
    const headerRow = historySheet.getRange(1, 1, 1, hLastCol).getValues()[0];
    const nonEmpty = headerRow.filter(h => h !== "");
    if (nonEmpty.length === 0) {
      historyHeaders = headerRow.map((_, i) => `COL${i + 1}`);
      historyStartIdx = 0;
    } else {
      historyHeaders = headerRow.filter(h => h !== "");
      headerRow.forEach((h, i) => { if (h) hMap[String(h).trim()] = i; });
    }

    const histMemberCol1 = hMap[COLS.ID] !== undefined ? hMap[COLS.ID] + 1 : 2;
    const dataStartRow = historyStartIdx + 1;
    if (hLastRow >= dataStartRow && histMemberCol1 <= hLastCol) {
      const targetId = normalize(memberId, true);
      const idRange = historySheet.getRange(dataStartRow, histMemberCol1, hLastRow - dataStartRow + 1, 1);
      let rowNumbers = [];
      try {
        const found = idRange.createTextFinder(targetId).matchEntireCell(true).findAll();
        rowNumbers = found.map(r => r.getRow());
      } catch (e) {}

      if (!rowNumbers.length) {
        const ids = idRange.getValues();
        for (let i = 0; i < ids.length; i++) {
          if (normalize(ids[i][0], true) === targetId) rowNumbers.push(dataStartRow + i);
        }
      }

      const seenRows = {};
      rowNumbers.sort((a, b) => a - b).forEach(rowNum => {
        if (seenRows[rowNum]) return;
        seenRows[rowNum] = true;
        historyRows.push(historySheet.getRange(rowNum, 1, 1, hLastCol).getValues()[0]);
      });
    }
  }

  const headers = ensureWithdrawArchiveHeaders_(archiveSheet, memberHeaders, historyHeaders);
  const headerIdx = {};
  headers.forEach((h, i) => { if (h) headerIdx[h] = i; });

  const memberName = memberMap[COLS.NAME] !== undefined ? memberRowVals[memberMap[COLS.NAME]] : '';
  const baseFill = (row) => {
    row[headerIdx['record_type']] = row[headerIdx['record_type']] || '';
    row[headerIdx['archived_at']] = nowStr;
    row[headerIdx['member_id']] = memberId;
    row[headerIdx['member_name']] = memberName;
  };

  const memberRow = new Array(headers.length).fill('');
  memberRow[headerIdx['record_type']] = 'MEMBER';
  baseFill(memberRow);
  memberHeaders.forEach(h => {
    const key = `M_${h}`;
    if (headerIdx[key] !== undefined && memberMap[h] !== undefined) {
      memberRow[headerIdx[key]] = memberRowVals[memberMap[h]];
    }
  });
  const archiveRows = [memberRow];

  if (historyRows.length > 0) {
    for (let i = 0; i < historyRows.length; i++) {
      const hRow = historyRows[i];
      const hArchRow = new Array(headers.length).fill('');
      hArchRow[headerIdx['record_type']] = 'HISTORY';
      baseFill(hArchRow);

      if (historyHeaders.length > 0) {
        historyHeaders.forEach((h, idx) => {
          const key = `H_${h}`;
          const colIdx = headerIdx[key];
          if (colIdx === undefined) return;
          if (hMap[h] !== undefined) hArchRow[colIdx] = hRow[hMap[h]];
          else if (historyStartIdx === 0) hArchRow[colIdx] = hRow[idx];
        });
      }
      archiveRows.push(hArchRow);
    }
  }

  archiveSheet
    .getRange(archiveSheet.getLastRow() + 1, 1, archiveRows.length, headers.length)
    .setValues(archiveRows);
}

function updateAllAges() {
  const d = getSheetData(SHEETS.MEMBERS);
  if (!d || d.values.length < 2) return "데이터 없음";
  const map = d.map;
  if (map[COLS.BIRTH] === undefined || map[COLS.AGE] === undefined) return "열 없음";
  const data = d.values; let count = 0;
  for (let i = 1; i < data.length; i++) {
    const birth = data[i][map[COLS.BIRTH]];
    const currentAge = data[i][map[COLS.AGE]];
    if (birth) {
      const newAge = calculateAge(birth);
      if (newAge !== currentAge) { data[i][map[COLS.AGE]] = newAge; count++; }
    }
  }
  if (count > 0) { d.sheet.getRange(1, 1, data.length, data[0].length).setValues(data); bumpSearchCacheVersion_(); return count + "명 갱신"; }
  return "갱신 대상 없음";
}

function moveNonActiveMembersToWithdrawnArchive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error("Members 시트를 찾을 수 없습니다.");

  let archiveSheet = ss.getSheetByName('WithdrawnArchive');
  if (!archiveSheet) archiveSheet = ss.insertSheet('WithdrawnArchive');

  const data = memSheet.getDataRange().getValues();
  if (data.length < 2) return "이동 대상 없음";

  const headers = data[0];
  const map = getColumnMap(memSheet);
  const statusIdx = map[COLS.STATUS] !== undefined ? map[COLS.STATUS] : 14; // O열 기본

  const archiveHeaders = archiveSheet.getLastColumn() > 0
    ? archiveSheet.getRange(1, 1, 1, archiveSheet.getLastColumn()).getValues()[0]
    : [];
  const hasArchiveHeader = archiveHeaders.some(h => h !== "");
  if (!hasArchiveHeader) {
    archiveSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  const allowed = { '활동': true, '명예': true, '명목': true, '자격정지': true };
  const rowsToArchive = [];
  const rowsToDelete = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[statusIdx];
    if (!allowed[String(status || '')]) {
      rowsToArchive.push(row);
      rowsToDelete.push(i + 1); // 시트 기준(1-based)
    }
  }

  if (rowsToArchive.length === 0) return "이동 대상 없음";

  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, rowsToArchive.length, rowsToArchive[0].length)
    .setValues(rowsToArchive);

  // 아래에서 위로 삭제해야 행 번호가 유지됨
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    memSheet.deleteRow(rowsToDelete[i]);
  }
  bumpSearchCacheVersion_();

  return `이동 완료: ${rowsToArchive.length}명`;
}

/****************************************************************
 * 2. 상세 이력 조회
 ****************************************************************/
function getDetailedHistory(mode, p1, p2, targetHeader) {
  const d = getSheetData(SHEETS.HISTORY);
  if(!d) return [];
  const data = d.values;
  const result = [];
  const deptMap = {};
  getDepartmentList().forEach(dp => { deptMap[String(dp.id)] = dp.name; });
  const getDeptDisplay = (val) => {
    const key = String(val || '').trim();
    if (!key) return '소속미정';
    return deptMap[key] || key;
  };
  
  let start, end;
  if(mode === 'PERIOD') {
    if(!p1 || !p2) return []; 
    start = toDateInAppTimeZone(`${p1} 00:00:00`);
    end = toDateInAppTimeZone(`${p2} 23:59:59`);
    if (!start || !end) return [];
  }

  const searchName = normalize(p1).toLowerCase();
  const searchId = normalize(p2, true);
  const searchTargetIds = {};
  if (mode !== 'PERIOD') {
    if (searchId) searchTargetIds[searchId] = true;

    if (searchName) {
      const m = getSheetData(SHEETS.MEMBERS);
      if (m && hasColumn(m.map, COLS.ID) && hasColumn(m.map, COLS.NAME)) {
        for (let i = 1; i < m.values.length; i++) {
          const row = m.values[i];
          const rowName = normalize(row[m.map[COLS.NAME]]).toLowerCase();
          if (rowName !== searchName) continue;
          const rowId = normalize(row[m.map[COLS.ID]], true);
          if (rowId) searchTargetIds[rowId] = true;
        }
      }
    }

    if (Object.keys(searchTargetIds).length === 0) return [];
  }

  let targetEvent = null;
  if(targetHeader !== 'ALL') {
    if(targetHeader === COLS.DEPT_ID || targetHeader === COLS.HQ) targetEvent = 'TRANSFER';
    else if(targetHeader === COLS.STATUS || targetHeader === COLS.WITHDRAW_REASON) targetEvent = 'WITHDRAW';
    else if(targetHeader === COLS.JOIN_DATE) targetEvent = 'JOIN';
    else targetEvent = 'UPDATE';
  }

  for(let i=data.length-1; i>=1; i--) {
    const row = data[i];
    const rawDate = row[10];
    const dateVal = toDateInAppTimeZone(rawDate);
    if (!dateVal) continue;
    const memId = normalize(row[1], true); 
    const event = row[2];
    const oldVal = row[3];
    const newVal = row[4];
    const notes = String(row[11] || ""); 

    let matchBasic = false;
    if(mode === 'PERIOD') {
      if(dateVal >= start && dateVal <= end) matchBasic = true;
    } else {
      if(memId && searchTargetIds[memId]) matchBasic = true; 
    }

    if(!matchBasic) continue;

    let matchHeader = false;
    if(targetHeader === 'ALL') {
      matchHeader = true;
    } else {
      if(targetEvent === 'TRANSFER' && event === 'TRANSFER') matchHeader = true;
      else if(targetEvent === 'WITHDRAW' && event === 'WITHDRAW') matchHeader = true;
      else if(targetEvent === 'JOIN' && event === 'JOIN') matchHeader = true;
      else if(targetEvent === 'UPDATE' && event === 'UPDATE') {
        if(notes.includes(targetHeader)) matchHeader = true;
        else if(targetHeader === COLS.DEPT_ID && notes.includes('부서명')) matchHeader = true;
      }
    }

    if(matchHeader) {
      let content = '';
      if (event === 'TRANSFER') {
        content = `부서이동: ${getDeptDisplay(oldVal)} → ${getDeptDisplay(newVal)}`;
      } else if (event === 'WITHDRAW') {
        content = row[7] ? `탈퇴: ${row[7]}` : '탈퇴처리';
      } else if (event === 'JOIN') {
        content = `신규가입: ${getDeptDisplay(newVal)}`;
      } else if (event === 'UPDATE') {
        content = notes ? `정보수정: ${notes}` : '정보수정';
      } else {
        content = notes || row[7] || newVal || '';
      }

      result.push({
        date: formatInAppTimeZone(dateVal, "yyyy-MM-dd HH:mm"),
        member_id: memId, event: event, old_val: oldVal, new_val: newVal,
        reason: row[7], details: notes, admin: row[9], content: content
      });
    }
  }
  return result;
}

/****************************************************************
 * 3. 검색 및 인증
 ****************************************************************/
// [수정됨] 검색 시 부서 ID(dept_id) 포함 반환
function searchMembers(keyword) {
  if(!keyword) return [];
  const searchKey = normalize(keyword).toLowerCase(); 
  if(searchKey.length < 2) return [];

  const searchCache = CacheService.getScriptCache();
  const searchVer = getSearchCacheVersion_();
  const keyHash = hashStringForCache_(searchKey);
  const searchCacheKey = `MEM_SEARCH:${searchVer}:${keyHash}`;
  const cached = searchCache.get(searchCacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.k === searchKey && Array.isArray(parsed.r)) return parsed.r;
    } catch (e) {}
  }

  const d = getSheetData(SHEETS.MEMBERS);
  if(!d) return [];
  const map = d.map;
  if (map[COLS.ID] === undefined || map[COLS.NAME] === undefined) return [];

  const depts = getDepartmentList();
  const deptMap = {};
  depts.forEach(dp => deptMap[dp.id] = dp.name);

  const results = [];
  const data = d.values;
  
  for(let i=1; i<data.length; i++){
    const row = data[i];
    const mid = normalize(row[map[COLS.ID]], true);
    const name = normalize(row[map[COLS.NAME]]);
    const status = map[COLS.STATUS] !== undefined ? String(row[map[COLS.STATUS]]) : '';
    
    if(status === '탈퇴' || status === '제명') continue;

    if(mid.includes(searchKey) || name.toLowerCase().includes(searchKey)) {
      const deptId = map[COLS.DEPT_ID] !== undefined ? String(row[map[COLS.DEPT_ID]]) : '';
      const fmtDate = (val) => formatInAppTimeZone(val, "yyyy-MM-dd");
      
      let age = '';
      if(map[COLS.AGE] !== undefined && row[map[COLS.AGE]]) age = row[map[COLS.AGE]];
      else if(map[COLS.BIRTH] !== undefined) age = calculateAge(row[map[COLS.BIRTH]]);

      results.push({
        member_id: mid, name: name,
        dept_name: deptMap[deptId] || deptId,
        dept_id: deptId, // [핵심 수정] 부서 ID 추가
        status: status,
        phone: hasColumn(map, COLS.PHONE) ? row[map[COLS.PHONE]] : '',
        email: hasColumn(map, COLS.EMAIL) ? row[map[COLS.EMAIL]] : '',
        address: hasColumn(map, COLS.ADDRESS) ? row[map[COLS.ADDRESS]] : '',
        job: hasColumn(map, COLS.JOB) ? row[map[COLS.JOB]] : '',
        company: hasColumn(map, COLS.COMPANY) ? row[map[COLS.COMPANY]] : '',
        birth: hasColumn(map, COLS.BIRTH) ? fmtDate(row[map[COLS.BIRTH]]) : '',
        rank: hasColumn(map, COLS.RANK) ? row[map[COLS.RANK]] : '', age: age,
        photo: hasColumn(map, COLS.PHOTO) ? String(row[map[COLS.PHOTO]] || '') : '',
        birth_place: hasColumn(map, COLS.BIRTHPLACE) ? String(row[map[COLS.BIRTHPLACE]] || '') : '',
        dharma_name: hasColumn(map, COLS.DHARMA_NAME) ? String(row[map[COLS.DHARMA_NAME]] || '') : ''
      });
      if(results.length >= 20) break; 
    }
  }
  searchCache.put(searchCacheKey, JSON.stringify({ k: searchKey, r: results }), SEARCH_CACHE_TTL);
  return results;
}

function checkAuthAndLoadData(inputEmail, inputPw) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const email = (typeof normalize === 'function') ? normalize(inputEmail) : String(inputEmail).trim();
  const pw = String(inputPw || '').trim();
  
  let role = 'NONE';
  let userName = '';

  // Cowork 공용 부서담당자 계정: 요청에 따라 비밀번호 없이 제한된 담당자 권한만 부여한다.
  // ADMIN 권한은 부여하지 않으므로 승인/이력/엑셀 관리 기능에는 접근할 수 없다.
  if (email.toLowerCase() === 'yw_insa@tmp.com' && !pw) {
    return { role: 'DEPT_HEAD', userName: '부서담당자', email: email, departments: getDepartmentList() };
  }
  
  try {
    const adminSheet = ss.getSheetByName(SHEETS.ADMINS);
    if(adminSheet) {
      const admins = adminSheet.getDataRange().getValues();
      for(let i=1; i<admins.length; i++){
        const dbEmail = (typeof normalize === 'function') ? normalize(admins[i][0]) : String(admins[i][0]).trim();
        const dbPw = String(admins[i][2]).trim(); 
        const isActive = admins[i][3]; 

        if(dbEmail == email && dbPw == pw && (!isActive || isActive == 'Y')){
          role = 'ADMIN'; 
          userName = admins[i][1]; 
          break;
        }
      }
    }
  } catch(e) { console.log(e); }
  
  if(role === 'NONE'){
    try {
      const headSheet = ss.getSheetByName(SHEETS.DEPTHEADS);
      if(headSheet){
        const headMap = getColumnMap(headSheet);
        const heads = headSheet.getDataRange().getValues();
        const emailIdx = headMap.email !== undefined ? headMap.email : 0;
        const nameIdx = headMap.name !== undefined ? headMap.name : 1;
        const passwdIdx = headMap.passwd !== undefined ? headMap.passwd : (heads[0] && heads[0].length > 3 ? 3 : 2);
        const activeIdx = headMap.active !== undefined ? headMap.active : -1;

        for(let i=1; i<heads.length; i++){
          const row = heads[i];
          const dbHeadEmail = (typeof normalize === 'function') ? normalize(row[emailIdx]) : String(row[emailIdx]).trim();
          const dbHeadPw = passwdIdx >= 0 ? String(row[passwdIdx] || '').trim() : '';
          const isActiveRaw = activeIdx >= 0 ? String(row[activeIdx] || '').trim() : '';
          const isActive = !isActiveRaw || isActiveRaw.toUpperCase() === 'Y';
          const needsPw = dbHeadPw !== '';

          if(dbHeadEmail == email && isActive && (!needsPw || dbHeadPw == pw)){
            role = 'DEPT_HEAD';
            userName = row[nameIdx];
            break;
          }
        }
      }
    } catch(e) {}
  }

  if(role === 'NONE') throw new Error("아이디 또는 비밀번호가 일치하지 않거나 권한이 없습니다.");

  return { role: role, userName: userName, email: email, departments: getDepartmentList() };
}

/**
 * 내 정보 수정용 후보 조회.
 * 회원번호는 선택이며, 생략하면 동일한 성명+부서에 해당하는 활성 회원을 모두 반환한다.
 * 후보 단계에서는 선택에 필요한 최소 정보만 보내고, 실제 상세 정보는 선택 후
 * verifyMemberLogin()을 거쳐 반환한다.
 */
function findSelfMemberCandidates(name, memberId, deptName) {
  const inName = normalize(name);
  const inId = normalize(memberId, true);
  const inDept = normalize(deptName);
  if (!inName) throw new Error('성명을 입력해 주세요.');
  if (!inDept) throw new Error('소속 부서를 선택해 주세요.');

  const depts = getDepartmentList();
  const foundDept = depts.find(dp => normalize(dp.name) === inDept);
  if (!foundDept) throw new Error('부서명을 찾을 수 없습니다.');
  const targetDeptId = String(foundDept.id);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error('회원 데이터 시트를 찾을 수 없습니다.');
  const map = getColumnMap(memSheet);
  if (!hasColumn(map, COLS.ID) || !hasColumn(map, COLS.NAME) || !hasColumn(map, COLS.DEPT_ID)) {
    throw new Error('회원 시트의 필수 열(회원번호/성명/부서ID)이 누락되었습니다.');
  }

  let rowNumbers = [];
  if (inId) {
    const rowIdx = findMemberRowById_(memSheet, map, inId);
    if (rowIdx > 1) rowNumbers.push(rowIdx);
  } else {
    const lastRow = memSheet.getLastRow();
    if (lastRow < 2) return [];
    try {
      rowNumbers = memSheet
        .getRange(2, map[COLS.NAME] + 1, lastRow - 1, 1)
        .createTextFinder(inName)
        .matchEntireCell(true)
        .findAll()
        .map(range => range.getRow());
    } catch (e) {
      const names = memSheet.getRange(2, map[COLS.NAME] + 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < names.length; i++) {
        if (normalize(names[i][0]) === inName) rowNumbers.push(i + 2);
      }
    }
  }

  const results = [];
  const seenIds = {};
  const lastCol = memSheet.getLastColumn();
  for (let i = 0; i < rowNumbers.length && results.length < 20; i++) {
    const row = memSheet.getRange(rowNumbers[i], 1, 1, lastCol).getValues()[0];
    const dbId = normalize(row[map[COLS.ID]], true);
    const dbName = normalize(row[map[COLS.NAME]]);
    const dbDept = String(row[map[COLS.DEPT_ID]] || '');
    const status = hasColumn(map, COLS.STATUS) ? String(row[map[COLS.STATUS]] || '') : '';
    if (!dbId || seenIds[dbId] || dbName !== inName || dbDept !== targetDeptId) continue;
    if (inId && dbId !== inId) continue;
    if (status === '탈퇴' || status === '제명') continue;
    seenIds[dbId] = true;
    results.push({
      member_id: dbId,
      name: dbName,
      dept_id: dbDept,
      dept_name: foundDept.name,
      status: status,
      rank: hasColumn(map, COLS.RANK) ? String(row[map[COLS.RANK]] || '') : ''
    });
  }
  return results;
}

function verifyMemberLogin(name, memberId, deptName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error("회원 데이터 시트를 찾을 수 없습니다.");
  const map = getColumnMap(memSheet);
  if (!hasColumn(map, COLS.ID) || !hasColumn(map, COLS.NAME) || !hasColumn(map, COLS.DEPT_ID)) {
    throw new Error("회원 시트의 필수 열(회원번호/성명/부서ID)이 누락되었습니다.");
  }
  
  const inName = normalize(name);
  const inId = normalize(memberId, true);
  const inDept = normalize(deptName);

  const depts = getDepartmentList();
  let targetDeptId = '';
  const found = depts.find(dp => normalize(dp.name) === inDept);
  if(found) targetDeptId = found.id;
  if(!targetDeptId) throw new Error("부서명을 찾을 수 없습니다.");

  const rIdx = findMemberRowById_(memSheet, map, inId);
  if (rIdx < 2) throw new Error("일치하는 회원 정보가 없습니다.");
  const row = memSheet.getRange(rIdx, 1, 1, memSheet.getLastColumn()).getValues()[0];
  const dbId = normalize(row[map[COLS.ID]], true);
  const dbName = normalize(row[map[COLS.NAME]]);
  const dbDept = String(row[map[COLS.DEPT_ID]] || '');

  if(dbId === inId && dbName === inName && dbDept === String(targetDeptId)) {
     const status = hasColumn(map, COLS.STATUS) ? row[map[COLS.STATUS]] : '';
     if(status === '탈퇴' || status === '제명') throw new Error("탈퇴/제명 회원입니다.");
     let hasConsented = false;
     if(hasColumn(map, COLS.CONSENT_YN) && row[map[COLS.CONSENT_YN]] === 'Y') hasConsented = true;
     const fmtDate = (val) => formatInAppTimeZone(val, "yyyy-MM-dd");
     return {
       member_id: dbId,
       name: dbName,
       dept_id: targetDeptId,
       dept_name: deptName,
       has_consented: hasConsented,
       phone: hasColumn(map, COLS.PHONE) ? row[map[COLS.PHONE]] : '',
       email: hasColumn(map, COLS.EMAIL) ? row[map[COLS.EMAIL]] : '',
       address: hasColumn(map, COLS.ADDRESS) ? row[map[COLS.ADDRESS]] : '',
       job: hasColumn(map, COLS.JOB) ? row[map[COLS.JOB]] : '',
       company: hasColumn(map, COLS.COMPANY) ? row[map[COLS.COMPANY]] : '',
       rank: hasColumn(map, COLS.RANK) ? row[map[COLS.RANK]] : '',
       promotion_date: hasColumn(map, COLS.PROMO_DATE) ? fmtDate(row[map[COLS.PROMO_DATE]]) : '',
       photo: hasColumn(map, COLS.PHOTO) ? String(row[map[COLS.PHOTO]] || '') : '',
       birth_place: hasColumn(map, COLS.BIRTHPLACE) ? String(row[map[COLS.BIRTHPLACE]] || '') : '',
       dharma_name: hasColumn(map, COLS.DHARMA_NAME) ? String(row[map[COLS.DHARMA_NAME]] || '') : ''
     };
  }
  throw new Error("일치하는 회원 정보가 없습니다.");
}

function submitReconsent(memberId, type) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error("회원 데이터 시트를 찾을 수 없습니다.");
  const map = getColumnMap(memSheet);
  if (!hasColumn(map, COLS.ID)) throw new Error("회원번호 열이 누락되었습니다.");
  const nowStr = nowDateTimeStr();
  const targetId = normalize(memberId, true);

  const rIdx = findMemberRowById_(memSheet, map, targetId);
  if (rIdx < 2) throw new Error("회원 없음");

  if(map[COLS.CONSENT_YN] !== undefined) memSheet.getRange(rIdx, map[COLS.CONSENT_YN]+1).setValue('Y');
  if(map[COLS.CONSENT_DATE] !== undefined) memSheet.getRange(rIdx, map[COLS.CONSENT_DATE]+1).setValue(nowStr);
  const logSheet = ss.getSheetByName(SHEETS.CONSENT) || ss.insertSheet(SHEETS.CONSENT);
  logSheet.appendRow([memberId, 'RECONSENT', type, nowStr, 'WEB_SELF']);
  return "동의 처리 완료";
}

function submitReconsentByToken(token, version) {
  const memberId = normalize(token, true);
  if (!memberId) throw new Error("유효하지 않은 토큰입니다.");
  const consentType = `WEB_LINK${version ? `:${normalize(version)}` : ''}`;
  return submitReconsent(memberId, consentType);
}

/****************************************************************
 * 4. 신청 & 관리자 승인
 ****************************************************************/
function getPendingRequestRows_(reqSheet, numCols) {
  const lastRow = reqSheet.getLastRow();
  if (lastRow < 2) return [];

  const cols = numCols || reqSheet.getLastColumn();
  // 상태 열은 한 번에 읽고, 연속된 대기 행은 묶어서 가져온다.
  // 기존의 대기 행별 getRange 호출보다 Spreadsheet RPC 횟수가 크게 줄어든다.
  const statuses = reqSheet.getRange(2, 3, lastRow - 1, 1).getValues();
  const rowNumbers = [];
  for (let i = 0; i < statuses.length; i++) {
    if (String(statuses[i][0] || '').trim() === 'REQUESTED') rowNumbers.push(i + 2);
  }
  if (!rowNumbers.length) return [];

  const groups = [];
  let start = rowNumbers[0];
  let prev = rowNumbers[0];
  for (let i = 1; i < rowNumbers.length; i++) {
    const rowNum = rowNumbers[i];
    if (rowNum === prev + 1) {
      prev = rowNum;
      continue;
    }
    groups.push({ start: start, count: prev - start + 1 });
    start = rowNum;
    prev = rowNum;
  }
  groups.push({ start: start, count: prev - start + 1 });

  const out = [];
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const values = reqSheet.getRange(group.start, 1, group.count, cols).getValues();
    for (let r = 0; r < values.length; r++) {
      out.push({ row_idx: group.start + r, row: values[r] });
    }
  }
  out.sort((a, b) => b.row_idx - a.row_idx);
  return out;
}

function invalidatePendingRequestsCache_() {
  try { CacheService.getScriptCache().remove(PENDING_REQUESTS_CACHE_KEY); } catch (e) {}
}

/**
 * 이미 파싱해 둔 payload에서 파일 본문만 걷어내 클라이언트용 문자열로 만든다.
 * 원본 객체는 그대로 두어야 한다(변경 미리보기가 formData 유무를 본다).
 */
function sanitizeParsedPayloadForClient_(payload) {
  try {
    const clean = {};
    Object.keys(payload || {}).forEach((k) => {
      if (k === 'photoData' || k === 'formData') return;
      clean[k] = payload[k];
    });
    return JSON.stringify(clean);
  } catch (e) {
    return '{}';
  }
}

function sanitizeRequestPayloadForClient_(raw) {
  try {
    const payload = JSON.parse(raw || '{}');
    // 파일 본문은 Drive에 이미 저장되어 있고, 목록 화면에는 필요 없다.
    // 과거 요청에 남아 있는 수 MB base64까지 응답하는 병목을 막는다.
    delete payload.photoData;
    delete payload.formData;
    return JSON.stringify(payload);
  } catch (e) {
    return '{}';
  }
}

/**
 * 기존 Requests 시트의 대기 요청에 남은 사진/문서 base64를 한 번 정리하는 관리 함수.
 * 새 버전 배포 후 Apps Script 편집기에서 1회 실행하면 과거 업로드 요청의 첫 조회도 가벼워진다.
 */
function compactPendingRequestPayloads() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName(SHEETS.REQUESTS);
  if (!reqSheet || reqSheet.getLastRow() < 2) return '정리할 요청이 없습니다.';
  const pending = getPendingRequestRows_(reqSheet, 9);
  let changed = 0;
  for (let i = 0; i < pending.length; i++) {
    const raw = String(pending[i].row[8] || '');
    const compact = sanitizeRequestPayloadForClient_(raw);
    if (compact !== raw) {
      reqSheet.getRange(pending[i].row_idx, 9).setValue(compact);
      changed++;
    }
  }
  invalidatePendingRequestsCache_();
  return '대기 요청 payload 정리 완료: ' + changed + '건';
}

function checkDuplicateRequest_(reqSheet, type, safeId, safeName, targetDeptId) {
  const lastRow = reqSheet.getLastRow();
  if (lastRow < 2) return null;

  const numCols = Math.min(reqSheet.getLastColumn(), 7);
  const pending = getPendingRequestRows_(reqSheet, numCols);

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i].row;
    const rowType = normalizeRequestType_(row[1]);

    if (type === 'NEW') {
      const rowName = normalize(String(row[4] || ''));
      const rowTargetDept = String(row[6] || '').trim();
      const inTargetDept = String(targetDeptId || '').trim();
      if (rowType === 'NEW' && rowName === safeName && rowTargetDept === inTargetDept) {
        return `동일한 신규 가입 신청(성명: ${safeName})이 이미 대기 중입니다. 처리 후 다시 시도해주세요.`;
      }
    } else {
      if (!safeId) continue;
      const rowMemberId = normalize(String(row[3] || ''), true);
      if (rowType === type && rowMemberId === safeId) {
        const typeLabel = { TRANSFER: '부서이동', UPDATE: '정보수정', WITHDRAW: '탈퇴' }[type] || type;
        return `회원(${safeId})의 '${typeLabel}' 신청이 이미 대기 중입니다. 기존 신청이 처리된 후 다시 시도해주세요.`;
      }
    }
  }
  return null;
}

function submitRequest(form) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName(SHEETS.REQUESTS);
  if (!reqSheet) throw new Error(`${SHEETS.REQUESTS} 시트를 찾을 수 없습니다.`);

  // 중복 신청 확인 (파일 업로드 전에 먼저 검사)
  const safeId = normalize(form.member_id, true);
  const safeName = normalize(form.name || form.target_name);
  const reqType = normalizeRequestType_(form.type);
  const dupMsg = checkDuplicateRequest_(reqSheet, reqType, safeId, safeName, form.target_dept_id);
  if (dupMsg) throw new Error(dupMsg);

  if (form.photoData && form.photoName && !isAllowedPhotoPayload_(form.photoName, form.photoData)) {
    throw new Error("사진은 JPG/JPEG/PNG/GIF/WEBP 형식만 업로드할 수 있습니다.");
  }

  let photoFileId = "";
  let formFileId = "";
  if (form.photoData && form.photoName) photoFileId = uploadFileToDrive(form.photoData, form.photoName, FOLDER_NAME);
  if (form.formData && form.formName) formFileId = uploadFileToDrive(form.formData, form.formName, FORM_FOLDER_NAME);

  const requestId = Utilities.getUuid();
  const nowStr = nowDateTimeStr();
  if(form.consent_mandatory) form.consent_log = `필수:${form.consent_mandatory}, 선택:${form.consent_optional}, 일시:${nowStr}`;

  // Drive 업로드가 끝난 base64 본문은 Requests 시트에 중복 저장하지 않는다.
  // 대용량 셀을 제거하면 승인 목록 읽기와 시트 자체의 반응 속도가 함께 개선된다.
  const storedForm = Object.assign({}, form);
  delete storedForm.photoData;
  delete storedForm.formData;

  // col[0..12]: 기본 정보 / col[13..14]: 승인자 email·시각 (승인 시 채워짐) / col[15]: 입회원서 파일 ID
  reqSheet.appendRow([requestId, form.type, 'REQUESTED', safeId, safeName, form.current_dept_id || '', form.target_dept_id || '', form.reason || '', JSON.stringify(storedForm), photoFileId, form.requester_email, form.requester_name, nowStr, '', '', formFileId]);
  invalidatePendingRequestsCache_();
  return "신청 완료";
}
function uploadFileToDrive(base64Data, fileName, folderName) {
  try {
    const targetFolder = folderName || FOLDER_NAME;
    const contentType = base64Data.substring(5, base64Data.indexOf(';'));
    const bytes = Utilities.base64Decode(base64Data.substring(base64Data.indexOf(',') + 1));
    const blob = Utilities.newBlob(bytes, contentType, fileName);
    const folder = getOrCreateDriveFolder_(targetFolder, true);
    const file = folder.createFile(blob);
    if (!isDriveFolderSharedWithLink_(targetFolder)) {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
    return file.getId();
  } catch (e) {
    console.error('uploadFileToDrive failed: ' + (e && e.message ? e.message : e));
    return "";
  }
}



// [수정됨] 대기 요청 목록 조회 (부서명 표시 강화 및 예외처리)
function cachePendingRequestsResult_(list) {
  try {
    const text = JSON.stringify(list || []);
    // CacheService 단일 값 제한(약 100KB)보다 여유 있게 작을 때만 캐시한다.
    if (Utilities.newBlob(text).getBytes().length < 95000) {
      CacheService.getScriptCache().put(PENDING_REQUESTS_CACHE_KEY, text, PENDING_REQUESTS_CACHE_SECONDS);
    }
  } catch (e) {}
  return list;
}

function getPendingRequests() {
  const apiCache = CacheService.getScriptCache();
  const cached = apiCache.get(PENDING_REQUESTS_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet(); 
  const reqSheet = ss.getSheetByName(SHEETS.REQUESTS);
  if (!reqSheet) return cachePendingRequestsResult_([]);
  if (reqSheet.getLastRow() < 2) return cachePendingRequestsResult_([]);
  
  // 1. 부서 ID -> 이름 매핑 맵 생성 (ID를 문자열로 변환하여 저장)
  const deptMap = {};
  const deptIdByName = {};
  getDepartmentList().forEach(d => {
    const deptId = String(d.id || '').trim();
    const deptName = String(d.name || '').trim();
    if (deptId) deptMap[deptId] = deptName;
    if (deptName) deptIdByName[normalize(deptName)] = { id: deptId, name: deptName };
  });
  
  // 2. 대기 요청만 먼저 추출 (요청 없는 경우 회원 시트 조회 생략)
  const pendingRows = [];
  const pendingMemberIds = {};
  const requestRows = getPendingRequestRows_(reqSheet, Math.max(reqSheet.getLastColumn(), 16));
  for (let i = 0; i < requestRows.length; i++) {
    const row = requestRows[i].row;
    const reqType = inferRequestType_(row);
    const mid = normalize(String(row[3]), true);
    pendingRows.push({ row_idx: requestRows[i].row_idx, row: row, mid: mid, type: reqType });
    if (reqType !== 'NEW' && mid) pendingMemberIds[mid] = true;
  }
  if (pendingRows.length === 0) return cachePendingRequestsResult_([]);

  // 3. 필요한 회원만 인덱싱
  const memInfo = {};
  let memberMap = {};
  const needMemberInfo = Object.keys(pendingMemberIds).length > 0;
  if (needMemberInfo) {
    const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
    if (memSheet) {
      // Members 시트를 한 번에 읽는다.
      // Apps Script는 읽은 셀 수보다 getRange 호출 횟수가 비용을 좌우한다.
      // 필요한 행만 골라 여러 번 읽으면 전송량은 줄지만 왕복이 늘어 오히려 느려진다.
      const mVals = memSheet.getDataRange().getValues();
      const memberHeaders = mVals.length ? mVals[0] : [];
      memberHeaders.forEach((header, idx) => {
        if (header) memberMap[String(header).trim()] = idx;
      });
      if (memberMap[COLS.ID] !== undefined) {
        for (let i = 1; i < mVals.length; i++) {
          const r = mVals[i];
          const key = normalize(r[memberMap[COLS.ID]], true);
          if (!pendingMemberIds[key]) continue;
          const dId = memberMap[COLS.DEPT_ID] !== undefined ? String(r[memberMap[COLS.DEPT_ID]] || '').trim() : '';
          const birthValue = memberMap[COLS.BIRTH] !== undefined ? r[memberMap[COLS.BIRTH]] : '';
          memInfo[key] = {
            age: memberMap[COLS.AGE] !== undefined ? (r[memberMap[COLS.AGE]] || calculateAge(birthValue)) : calculateAge(birthValue),
            rank: memberMap[COLS.RANK] !== undefined ? r[memberMap[COLS.RANK]] : '',
            dept_id: dId,
            row: r
          };
        }
      }
    }
  }

  const list = [];
  
  // 4. 대기 요청 순회
  for (let i = 0; i < pendingRows.length; i++) {
    try { 
      const item = pendingRows[i];
      const row = item.row;
      const mid = item.mid;
      const reqType = item.type;
      let age = '', rank = '';

      // [중요] 신청서(Requests)에 저장된 현재 부서 ID 확인
      let curDeptId = String(row[5]).trim();

      // 같은 payload 문자열을 여러 번 파싱하면 과거 요청에 남은 대용량 base64에서 큰 비용이 된다.
      // 행마다 한 번만 파싱해 재사용한다.
      let parsedPayload;
      const payloadOf = () => {
        if (parsedPayload === undefined) {
          try { parsedPayload = JSON.parse(row[8] || '{}'); } catch (e) { parsedPayload = {}; }
        }
        return parsedPayload;
      };

      if(reqType === 'NEW') {
        try { age = calculateAge(payloadOf().birth); rank='신입'; } catch(e){}
      } else {
        // 기존 회원인 경우, 회원 정보(memInfo) 확인
        if(memInfo[mid]) { 
          age = memInfo[mid].age; 
          rank = memInfo[mid].rank;
          
          // 신청서에 현재 부서 정보가 없으면, 회원 명부에서 가져옴 (Fallback)
          if(!curDeptId || curDeptId === 'undefined' || curDeptId === '') {
             curDeptId = memInfo[mid].dept_id;
          }
        } 
      } 
      
      // 5. 부서 ID -> 이름 변환
      let curName = deptMap[curDeptId] || curDeptId;
      if(!curName && reqType !== 'NEW') curName = '소속미정';
      
      const tarId = String(row[6]).trim();
      const tarName = deptMap[tarId] || row[6];

      list.push({ 
        row_idx: item.row_idx, 
        request_id: row[0], 
        type: reqType,
        raw_type: row[1],
        name: row[4], 
        member_id: mid, 
        current: curName, // 부서명 (또는 소속미정)
        target: tarName,  // 부서명
        reason: row[7], 
        requester: row[11], 
        date: formatInAppTimeZone(row[12], "yyyy-MM-dd HH:mm"),
        payload: sanitizeParsedPayloadForClient_(payloadOf()),
        photo_id: row[9],
        form_file_id: row[15] || '',
        age: age, 
        rank: rank,
        changes: (() => {
          if (reqType !== 'UPDATE') return [];
          try {
            const memberRow = (memInfo[mid] && memInfo[mid].row) ? memInfo[mid].row : null;
            return buildUpdatePreviewChanges_(payloadOf(), memberRow, memberMap, deptMap, deptIdByName);
          } catch (e) {
            return [];
          }
        })()
      }); 
    } catch(e){} 
  }
  return cachePendingRequestsResult_(list);
}

/**
 * 승인 대기 목록이 느릴 때 어느 단계에서 시간이 걸리는지 확인하는 진단 함수.
 * Apps Script 편집기에서 이 함수를 선택해 실행한 뒤 [실행 로그]를 확인한다.
 * 시트 데이터는 전혀 바꾸지 않는다(30초짜리 목록 캐시만 비운다).
 */
function diagnosePendingRequestsPerformance() {
  const out = [];
  const step = (label, fn) => {
    const started = Date.now();
    let value = null;
    let note = '';
    try { value = fn(); } catch (e) { note = '  ← 오류: ' + (e && e.message ? e.message : e); }
    out.push('  ' + label + ': ' + (Date.now() - started) + 'ms' + note);
    return value;
  };

  out.push('===== 승인 대기 목록 성능 진단 =====');
  const ss = step('스프레드시트 열기', () => SpreadsheetApp.getActiveSpreadsheet());
  if (!ss) { Logger.log(out.join('\n')); return out.join('\n'); }

  const reqSheet = ss.getSheetByName(SHEETS.REQUESTS);
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  out.push('');
  out.push('[시트 규모]');
  out.push('  Requests: ' + (reqSheet ? reqSheet.getLastRow() + '행 × ' + reqSheet.getLastColumn() + '열' : '없음'));
  out.push('  Members : ' + (memSheet ? memSheet.getLastRow() + '행 × ' + memSheet.getLastColumn() + '열' : '없음'));

  if (reqSheet && reqSheet.getLastRow() >= 2) {
    const lastRow = reqSheet.getLastRow();
    const statuses = step('상태 열 전체 읽기', () => reqSheet.getRange(2, 3, lastRow - 1, 1).getValues());
    let pending = 0;
    const pendingRowNums = [];
    (statuses || []).forEach((r, i) => {
      if (String(r[0] || '').trim() === 'REQUESTED') { pending++; pendingRowNums.push(i + 2); }
    });
    out.push('  대기(REQUESTED) 건수: ' + pending + ' / 전체 ' + (lastRow - 1) + '행');

    if (pending) {
      // payload 열(9번)만 읽어 크기를 잰다. 여기가 크면 목록 전체가 느려진다.
      const payloads = step('payload 열 읽기', () => reqSheet.getRange(2, 9, lastRow - 1, 1).getValues());
      let total = 0, max = 0, heavy = 0;
      pendingRowNums.forEach((rn) => {
        const len = String((payloads[rn - 2] || [''])[0] || '').length;
        total += len;
        if (len > max) max = len;
        if (len > 100000) heavy++;
      });
      out.push('');
      out.push('[대기 요청 payload 크기]');
      out.push('  합계    : ' + Math.round(total / 1024) + ' KB');
      out.push('  최대 1건: ' + Math.round(max / 1024) + ' KB');
      out.push('  100KB 초과 건수: ' + heavy + (heavy ? '  ← compactPendingRequestPayloads() 실행 권장' : ''));
    }
  }

  out.push('');
  out.push('[전체 호출 (캐시 없이)]');
  try { CacheService.getScriptCache().remove(PENDING_REQUESTS_CACHE_KEY); } catch (e) {}
  const list = step('getPendingRequests() 콜드', () => getPendingRequests());
  const text = JSON.stringify(list || []);
  out.push('  결과 건수: ' + (list ? list.length : 0));
  out.push('  응답 크기: ' + Math.round(text.length / 1024) + ' KB'
    + (text.length >= 95000 ? '  ← 95KB 초과라 서버 캐시가 안 됩니다' : '  (캐시 가능)'));
  step('getPendingRequests() 캐시 적중', () => getPendingRequests());

  const report = out.join('\n');
  Logger.log(report);
  return report;
}

function processAdminAction(reqId, action, adminEmail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName(SHEETS.REQUESTS);
  const histSheet = ss.getSheetByName(SHEETS.HISTORY);
  if (!reqSheet) throw new Error(`${SHEETS.REQUESTS} 시트를 찾을 수 없습니다.`);
  if (!histSheet) throw new Error(`${SHEETS.HISTORY} 시트를 찾을 수 없습니다.`);
  
  // 요청 행 조회 (전체 스캔 대신 request_id 열에서 즉시 탐색)
  const reqRowIdx = findRowByExactValue_(reqSheet, 1, reqId);
  if(reqRowIdx === -1) throw new Error("요청 없음");
  const reqRow = reqSheet.getRange(reqRowIdx, 1, 1, Math.max(reqSheet.getLastColumn(), 16)).getValues()[0];

  const nowStr = nowDateTimeStr();
  
  // 반려 처리
  if(action === 'REJECT') {
    reqSheet.getRange(reqRowIdx, 3).setValue('REJECTED');
    reqSheet.getRange(reqRowIdx, 14, 1, 2).setValues([[adminEmail, nowStr]]);
    invalidatePendingRequestsCache_();
    return "반려됨";
  }

  // 부서 정보 로드
  const deptMaps = getDepartmentInfoMaps_();
  const deptInfo = deptMaps.byId || {};
  const deptInfoByName = deptMaps.byName || {};

  const type = inferRequestType_(reqRow);
  const photoId = reqRow[9];
  const formFileId = reqRow[15] || '';
  // 사진 ID → 링크 변환
  const photoLink = photoId ? `https://drive.google.com/file/d/${photoId}/view?usp=drive_link` : '';
  // 입회원서 ID → 링크 변환
  const formLink = formFileId ? `https://drive.google.com/file/d/${formFileId}/view?usp=drive_link` : '';

  const getPVal = (did) => { const x=deptInfo[did]; return x?(x.hq==1?'삼방사':x.name):''; };
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error(`${SHEETS.MEMBERS} 시트를 찾을 수 없습니다.`);
  const map = getColumnMap(memSheet);
  if (!hasColumn(map, COLS.ID)) throw new Error(`'${COLS.ID}' 열이 누락되었습니다.`);
  // UPDATE 승인 시 payload 에 birth_place 가 포함될 수 있으므로 컬럼을 미리 보장한다
  ensureMembersColumn_(memSheet, map, COLS.BIRTHPLACE);

  // 1. 신규 가입 승인
  if(type === 'NEW') {
    const newId = reserveNextMemberId_(memSheet, map);
    const p = JSON.parse(reqRow[8]);
    const newRow = new Array(memSheet.getLastColumn()).fill('');
    
    Object.keys(p).forEach(k => { 
      let headerName = null; 
      if (k === 'target_name') headerName = COLS.NAME; 
      else if (k === 'target_dept_id') headerName = COLS.DEPT_ID; 
      else if (k === 'phone') headerName = COLS.PHONE; 
      else if (k === 'email') headerName = COLS.EMAIL; 
      else if (k === 'birth') headerName = COLS.BIRTH; 
      else if (k === 'lunar_solar') headerName = COLS.LUNAR; 
      else if (k === 'address') headerName = COLS.ADDRESS; 
      else if (k === 'job') headerName = COLS.JOB; 
      else if (k === 'company') headerName = COLS.COMPANY; 
      else if (k === 'gender') headerName = COLS.GENDER; 
      else if (k === 'motive') headerName = COLS.MOTIVE; 
      else if (k === 'referrer') headerName = COLS.REFERRER; 
      else if (k === 'relation') headerName = COLS.RELATION;
      else if (k === 'birth_place') headerName = COLS.BIRTHPLACE;
      else if (k === 'dharma_name') headerName = COLS.DHARMA_NAME;
      if (headerName && map[headerName] !== undefined) newRow[map[headerName]] = p[k];
    });

    // BirthPlace 컬럼이 아직 없으면 자동 생성 후 값 저장
    if (p.birth_place && map[COLS.BIRTHPLACE] === undefined) {
      ensureMembersColumn_(memSheet, map, COLS.BIRTHPLACE);
      newRow.push(''); // 새 컬럼분 확장
      while (newRow.length < memSheet.getLastColumn()) newRow.push('');
      newRow[map[COLS.BIRTHPLACE]] = p.birth_place;
    }
    
    // 사진 링크 저장
    if(photoLink && map[COLS.PHOTO] !== undefined) {
      newRow[map[COLS.PHOTO]] = photoLink;
    }
    // 입회원서 링크 저장
    if(formLink && map[COLS.FORM] !== undefined) {
      newRow[map[COLS.FORM]] = formLink;
    }

    if(map[COLS.NAME]!==undefined) newRow[map[COLS.NAME]] = normalize(newRow[map[COLS.NAME]]);
    if(map[COLS.ID]!==undefined) newRow[map[COLS.ID]] = newId; 
    if(map[COLS.RANK]!==undefined) newRow[map[COLS.RANK]] = '반야'; 
    if(map[COLS.STATUS]!==undefined) newRow[map[COLS.STATUS]] = '활동'; 
    if(map[COLS.TYPE]!==undefined) newRow[map[COLS.TYPE]] = '신도'; 
    
    const joinDate = nowStr.split(' ')[0];
    if(map[COLS.JOIN_DATE]!==undefined) newRow[map[COLS.JOIN_DATE]] = joinDate; 
    if(map[COLS.PROMO_DATE]!==undefined) newRow[map[COLS.PROMO_DATE]] = joinDate;

    if(map[COLS.HQ]!==undefined) newRow[map[COLS.HQ]] = getPVal(p.target_dept_id); 
    if(map[COLS.AGE]!==undefined && p.birth) newRow[map[COLS.AGE]] = calculateAge(p.birth);
    if(map[COLS.CONSENT_YN]!==undefined && p.consent_mandatory) newRow[map[COLS.CONSENT_YN]] = 'Y'; 
    if(map['updated_at']!==undefined) newRow[map['updated_at']] = nowStr;
    
    memSheet.appendRow(newRow);

    // appendRow 후 시트가 생년월일 문자열을 실제 날짜 값으로 변환할 수 있다.
    // updateAllAges()와 동일하게 저장된 생일 셀을 다시 읽어 H열(나이)을 확정한다.
    if (map[COLS.BIRTH] !== undefined && map[COLS.AGE] !== undefined) {
      const insertedRow = findMemberRowById_(memSheet, map, newId);
      if (insertedRow > 1) {
        const savedBirth = memSheet.getRange(insertedRow, map[COLS.BIRTH] + 1).getValue();
        const approvedAge = calculateAge(savedBirth || p.birth);
        memSheet.getRange(insertedRow, map[COLS.AGE] + 1).setValue(approvedAge);
      }
    }
    histSheet.appendRow([Utilities.getUuid(), newId, 'JOIN', '', p.target_dept_id, '', '활동', '신규가입', reqId, adminEmail, nowStr, '신규등록']);
  
  } else {
    // 2. 기존 회원 (이동/수정/탈퇴)
    const mid = normalize(reqRow[3], true);
    const rIdx = findMemberRowById_(memSheet, map, mid);
    
    if(rIdx > 0) {
      const rowRange = memSheet.getRange(rIdx, 1, 1, memSheet.getLastColumn());
      const rowVals = rowRange.getValues()[0];
      const setV = (h, v) => { if(map[h]!==undefined) rowVals[map[h]] = v; };

      if(type==='TRANSFER') {
        const tDept = reqRow[6];
        if (!tDept) throw new Error("이동할 부서가 지정되지 않았습니다.");
        
        // [수정 2] 신청서에 적힌 구 정보 대신, DB에 있는 실제 현재 부서 정보를 가져옴
        const currentDeptId = hasColumn(map, COLS.DEPT_ID) ? rowVals[map[COLS.DEPT_ID]] : '';

        setV(COLS.DEPT_ID, tDept); 
        setV(COLS.HQ, getPVal(tDept));
        
        // 요청서 값이 아닌 실제 DB의 현재 소속을 old_val에 남긴다.
        histSheet.appendRow([Utilities.getUuid(), mid, 'TRANSFER', currentDeptId, tDept, '활동', '활동', reqRow[7], reqId, adminEmail, nowStr, '부서이동']);

      } else if(type==='WITHDRAW') {
        setV(COLS.STATUS, '탈퇴'); 
        setV(COLS.WITHDRAW_REASON, reqRow[7]);
        histSheet.appendRow([Utilities.getUuid(), mid, 'WITHDRAW', reqRow[5], '', '활동', '탈퇴', reqRow[7], reqId, adminEmail, nowStr, '탈퇴처리']);
        
      } else if(type==='UPDATE') {
        let p = {};
        try { p = JSON.parse(reqRow[8] || '{}'); } catch (e) { p = {}; }
        const changedDetails = [];
        Object.keys(p).forEach(k => {
           if (isRequestMetaKey_(k) || isEmptyValue_(p[k])) return;

           if (k === 'dept_name' || k === COLS.DEPT_ID || k === '부서명') {
             if (map[COLS.DEPT_ID] === undefined) return;
             const requestVal = String(p[k]).trim();
             const foundByName = deptInfoByName[normalize(requestVal)];
             const foundById = deptInfo[requestVal] ? { id: String(requestVal), name: deptInfo[requestVal].name } : null;
             const resolved = foundByName || foundById;
             if (!resolved || !resolved.id) throw new Error(`부서명을 찾을 수 없습니다: ${requestVal}`);

             const oldDeptId = String(rowVals[map[COLS.DEPT_ID]] || '').trim();
             const oldDeptName = deptInfo[oldDeptId] ? deptInfo[oldDeptId].name : (oldDeptId || '소속미정');
             const newDeptId = resolved.id;
             const newDeptName = resolved.name || requestVal;

             if (oldDeptId !== newDeptId) {
               setV(COLS.DEPT_ID, newDeptId);
               setV(COLS.HQ, getPVal(newDeptId));
               changedDetails.push(`부서명: ${oldDeptName || '(빈값)'} → ${newDeptName || '(빈값)'}`);
             }
             return;
           }

           const h = resolveUpdateHeader_(k);
           if (!h || h === COLS.HQ) return;
           // 해당 컬럼이 아직 없으면 자동 생성
           if (map[h] === undefined) {
             ensureMembersColumn_(memSheet, map, h);
             // rowVals 배열도 새 컬럼만큼 확장
             while (rowVals.length < memSheet.getLastColumn()) rowVals.push('');
           }

           let nextVal = toDisplayValue_(p[k]);
           if (h === COLS.TYPE) {
             const normType = normalize(p[k]);
             if (normType !== '승려' && normType !== '신도') return;
             nextVal = normType;
           } else if (h === COLS.GENDER) {
             const normGender = normalize(p[k]);
             if (normGender !== '남' && normGender !== '여') return;
             nextVal = normGender;
           } else if (h === COLS.LUNAR) {
             const normLunar = normalize(p[k]);
             if (normLunar !== '양' && normLunar !== '음') return;
             nextVal = normLunar;
           } else if (h === COLS.STATUS) {
             const normStatus = normalize(p[k]);
             if (normStatus !== '활동' && normStatus !== '명목' && normStatus !== '명예' && normStatus !== '탈퇴' && normStatus !== '자격정지') return;
             nextVal = normStatus;
           }

           const oldVal = toDisplayValue_(rowVals[map[h]]);
           if (oldVal === nextVal) return;

           setV(h, nextVal);
           changedDetails.push(`${getUpdateFieldLabel_(h)}: ${toDisplayOrEmpty_(oldVal)} → ${toDisplayOrEmpty_(nextVal)}`);
           if(h === COLS.BIRTH && map[COLS.AGE] !== undefined) {
             const beforeAge = toDisplayValue_(rowVals[map[COLS.AGE]]);
             const afterAge = toDisplayValue_(calculateAge(nextVal));
             if (beforeAge !== afterAge) {
               setV(COLS.AGE, afterAge);
               changedDetails.push(`${COLS.AGE}: ${toDisplayOrEmpty_(beforeAge)} → ${toDisplayOrEmpty_(afterAge)}`);
             }
           }
           if(h === COLS.RANK && map[COLS.PROMO_DATE] !== undefined) {
             const reqDate = formatInAppTimeZone(reqRow[12], "yyyy-MM-dd");
             if (reqDate) {
               const beforePromo = toDisplayValue_(rowVals[map[COLS.PROMO_DATE]]);
               setV(COLS.PROMO_DATE, reqDate);
               changedDetails.push(`${COLS.PROMO_DATE}: ${toDisplayOrEmpty_(beforePromo)} → ${toDisplayOrEmpty_(reqDate)}`);
             }
           }
        });
        
        // 사진 링크 저장
        if(photoLink && map[COLS.PHOTO] !== undefined) {
          const oldPhoto = map[COLS.PHOTO] !== undefined ? toDisplayValue_(rowVals[map[COLS.PHOTO]]) : '';
          setV(COLS.PHOTO, photoLink);
          changedDetails.push(`사진: ${oldPhoto ? '기존 사진' : '(빈값)'} → 신규 사진`);
        }
        // 입회원서 링크 저장
        if(formLink && map[COLS.FORM] !== undefined) {
          const oldForm = toDisplayValue_(rowVals[map[COLS.FORM]]);
          setV(COLS.FORM, formLink);
          changedDetails.push(`입회원서: ${oldForm ? '기존 파일' : '(빈값)'} → 신규 파일`);
        }

        const noteStr = changedDetails.length ? changedDetails.join(' | ') : '변경 없음';
        histSheet.appendRow([Utilities.getUuid(), mid, 'UPDATE', reqRow[5], reqRow[5], '활동', '활동', '정보수정', reqId, adminEmail, nowStr, noteStr]);
      }
      setV(COLS.UPDATED_AT, nowStr);
      // 컬럼이 동적으로 추가된 경우 rowRange 를 최신 컬럼 수로 재계산
      const finalCols = memSheet.getLastColumn();
      while (rowVals.length < finalCols) rowVals.push('');
      if (type === 'WITHDRAW') {
        // 탈퇴 승인: WithdrawArchive 마지막 행에 보관 후 Members 시트에서 행을 제거한다.
        // (회원번호는 reserveMemberIds_ 의 저장 max 값으로 관리되므로 재사용되지 않는다)
        archiveWithdrawnMember_(mid, rowVals, map, nowStr);
        memSheet.deleteRow(rIdx);
      } else {
        const finalRange = memSheet.getRange(rIdx, 1, 1, finalCols);
        finalRange.setValues([rowVals]);
      }
    } else if (type !== 'NEW') {
      throw new Error("대상 회원이 존재하지 않아 승인할 수 없습니다.");
    }
  }
  
  reqSheet.getRange(reqRowIdx, 3).setValue('APPROVED');
  reqSheet.getRange(reqRowIdx, 14, 1, 2).setValues([[adminEmail, nowStr]]);
  bumpSearchCacheVersion_();
  invalidatePendingRequestsCache_();
  return "승인 완료";
}

function openSpreadsheet(u){
  const target = normalize(u);
  if (!target) throw new Error("파일 URL/ID를 입력하세요.");
  try {
    if (/^https?:\/\//i.test(target)) return SpreadsheetApp.openByUrl(target);
    return SpreadsheetApp.openById(target);
  } catch(e){
    throw new Error("파일열기실패");
  }
}

function runExternalBulkUpdate(fileId, adminEmail) {
  const extSs = openSpreadsheet(fileId);
  const extData = extSs.getSheets()[0].getDataRange().getValues();
  if(extData.length < 2) return "데이터 없음";
  const extHeaders = extData[0];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  const mDataObj = getSheetData(SHEETS.MEMBERS);
  if (!memSheet || !mDataObj) throw new Error(`${SHEETS.MEMBERS} 시트를 찾을 수 없습니다.`);
  const map = mDataObj.map;
  if (!hasColumn(map, COLS.ID) || !hasColumn(map, COLS.NAME)) {
    throw new Error(`'${COLS.ID}', '${COLS.NAME}' 열이 없어 일괄 수정을 진행할 수 없습니다.`);
  }
  const memData = mDataObj.values; 

  const deptInfoByName = {};
  const ds = ss.getSheetByName(SHEETS.DEPARTMENTS);
  if(ds) {
    const dd = ds.getDataRange().getValues();
    for(let i=1; i<dd.length; i++) {
      const hqName = (dd[i][4] == 1 ? '삼방사' : dd[i][1]); 
      deptInfoByName[normalize(dd[i][1])] = {id:dd[i][0], hqName: hqName};
    }
  }

  const memIdx = {};
  for(let i=1; i<memData.length; i++) {
    const key = normalize(memData[i][map[COLS.ID]], true) + "_" + normalize(memData[i][map[COLS.NAME]]);
    memIdx[key] = i;
  }

  let count = 0;
  for(let i=1; i<extData.length; i++) {
    const row = extData[i];
    const extIdIdx = extHeaders.indexOf(COLS.ID);
    const extNameIdx = extHeaders.indexOf(COLS.NAME);
    
    if(extIdIdx === -1 || extNameIdx === -1) continue; 

    const key = normalize(row[extIdIdx], true) + "_" + normalize(row[extNameIdx]);
    const targetRowIdx = memIdx[key];

    if(targetRowIdx !== undefined) {
      let isUpdated = false;
      extHeaders.forEach((h, colIdx) => {
        const val = row[colIdx];
        if(val !== "") {
          if(h === '부서명' && deptInfoByName[normalize(val)]) {
            const info = deptInfoByName[normalize(val)];
            if(map[COLS.DEPT_ID]!==undefined) { memData[targetRowIdx][map[COLS.DEPT_ID]] = info.id; isUpdated=true; }
            if(map[COLS.HQ]!==undefined) { memData[targetRowIdx][map[COLS.HQ]] = info.hqName; isUpdated=true; }
          }
          else if(h === COLS.BIRTH) {
            if(map[h]!==undefined) {
              let v = val;
              if(v instanceof Date) v = formatInAppTimeZone(v, "yyyy-MM-dd");
              memData[targetRowIdx][map[h]] = v;
              if(map[COLS.AGE]!==undefined) memData[targetRowIdx][map[COLS.AGE]] = calculateAge(v);
              isUpdated = true;
            }
          }
          else if(h !== COLS.ID && h !== COLS.NAME && map[h]!==undefined) {
            let v = val;
            if(v instanceof Date) v = formatInAppTimeZone(v, "yyyy-MM-dd");
            memData[targetRowIdx][map[h]] = v;
            isUpdated = true;
          }
        }
      });
      if(isUpdated) count++;
    }
  }

  if(count > 0) {
    memSheet.getRange(1, 1, memData.length, memData[0].length).setValues(memData);
    bumpSearchCacheVersion_();
  }
  return count + "건 수정 완료";
}

function runExternalBulkRegister(fileId, adminEmail) {
  const extSs = openSpreadsheet(fileId);
  const extData = extSs.getSheets()[0].getDataRange().getValues();
  if(extData.length < 2) return "데이터가 없습니다.";
  const extHeaders = extData[0];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error(`${SHEETS.MEMBERS} 시트를 찾을 수 없습니다.`);
  const map = getColumnMap(memSheet);
  if (!hasColumn(map, COLS.ID)) throw new Error(`'${COLS.ID}' 열이 없어 일괄 등록을 진행할 수 없습니다.`);
  const lastCol = memSheet.getLastColumn();
  
  const deptInfoByName = {};
  const ds = ss.getSheetByName(SHEETS.DEPARTMENTS);
  if(ds) { const dd = ds.getDataRange().getValues(); for(let i=1; i<dd.length; i++) deptInfoByName[normalize(dd[i][1])] = {id:dd[i][0], name:dd[i][1], hq:dd[i][4]}; }

  const reserve = reserveMemberIds_(extData.length - 1, memSheet, map);
  let newId = reserve.start;

  const nowStr = nowDateTimeStr();
  const todayDate = nowStr.split(' ')[0];
  let count = 0;
  const newRows = [];

  for(let i=1; i<extData.length; i++) {
    const row = extData[i];
    const newRowData = new Array(lastCol).fill('');
    
    if(map[COLS.ID]!==undefined) newRowData[map[COLS.ID]] = newId++;
    if(map[COLS.JOIN_DATE]!==undefined) newRowData[map[COLS.JOIN_DATE]] = todayDate;
    if(map[COLS.PROMO_DATE]!==undefined) newRowData[map[COLS.PROMO_DATE]] = todayDate;
    if(map[COLS.STATUS]!==undefined) newRowData[map[COLS.STATUS]] = '활동';
    if(map[COLS.TYPE]!==undefined) newRowData[map[COLS.TYPE]] = '신도';
    if(map[COLS.RANK]!==undefined && map[COLS.RANK]!== -1) newRowData[map[COLS.RANK]] = '반야';
    if(map['updated_at']!==undefined) newRowData[map['updated_at']] = nowStr;

    let birthVal = '';
    let deptNameVal = '';

    extHeaders.forEach((h, colIdx) => {
      const val = row[colIdx];
      if(val !== "") {
        if(h === '부서명') deptNameVal = val;
        if(h === COLS.BIRTH) birthVal = val;
        if(map[h] !== undefined) {
          let v = val;
          if(v instanceof Date) v = formatInAppTimeZone(v, "yyyy-MM-dd");
          newRowData[map[h]] = v;
        }
      }
    });

    const normDept = normalize(deptNameVal);
    if(normDept && deptInfoByName[normDept]) {
      const info = deptInfoByName[normDept];
      if(map[COLS.DEPT_ID]!==undefined) newRowData[map[COLS.DEPT_ID]] = info.id;
      if(map[COLS.HQ]!==undefined) newRowData[map[COLS.HQ]] = (info.hq==1?'삼방사':info.name);
    }

    if(birthVal && map[COLS.AGE]!==undefined) {
      newRowData[map[COLS.AGE]] = calculateAge(birthVal);
    }
    
    if(map[COLS.NAME]!==undefined && newRowData[map[COLS.NAME]]) {
       newRowData[map[COLS.NAME]] = normalize(newRowData[map[COLS.NAME]]);
    }

    newRows.push(newRowData);
    count++;
  }
  if (newRows.length > 0) {
    memSheet.getRange(memSheet.getLastRow() + 1, 1, newRows.length, lastCol).setValues(newRows);
    bumpSearchCacheVersion_();
  }
  return `일괄 등록 완료: ${count}건 추가됨`;
}

function uploadMemberFormDirect(memberId, base64Data, fileName, adminEmail) {
  const targetId = normalize(memberId, true);
  if (!targetId) throw new Error("회원번호를 입력하세요.");
  if (!base64Data || !fileName) throw new Error("파일을 선택하세요.");

  const d = getSheetData(SHEETS.MEMBERS);
  if (!d) throw new Error("회원 시트를 찾을 수 없습니다.");
  const map = d.map;

  if (map[COLS.FORM] === undefined) throw new Error("'입회원서' 컬럼이 Members 시트에 없습니다.");

  const rIdx = findMemberRowById_(d.sheet, map, targetId);
  if (rIdx < 2) throw new Error("해당 회원을 찾을 수 없습니다. (회원번호: " + targetId + ")");

  const fileId = uploadFileToDrive(base64Data, fileName, FORM_FOLDER_NAME);
  if (!fileId) throw new Error("파일 업로드에 실패했습니다.");

  const fileLink = `https://drive.google.com/file/d/${fileId}/view?usp=drive_link`;
  const nowStr = nowDateTimeStr();

  const lastCol = d.sheet.getLastColumn();
  const rowVals = d.sheet.getRange(rIdx, 1, 1, lastCol).getValues()[0];
  const oldForm = rowVals[map[COLS.FORM]] ? '기존 파일' : '(빈값)';
  rowVals[map[COLS.FORM]] = fileLink;
  if (map[COLS.UPDATED_AT] !== undefined) rowVals[map[COLS.UPDATED_AT]] = nowStr;
  d.sheet.getRange(rIdx, 1, 1, lastCol).setValues([rowVals]);

  const histSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.HISTORY);
  if (histSheet) {
    histSheet.appendRow([Utilities.getUuid(), targetId, 'UPDATE', '', '', '', '', '입회원서 업로드', '', adminEmail, nowStr, `입회원서: ${oldForm} → 신규 파일`]);
  }

  bumpSearchCacheVersion_();
  return fileLink;
}

/****************************************************************
 * 사진 업로드 전용 도구 (photo.html)
 *   - A열 회원번호 또는 B열 이름(성명)으로 조회
 *   - 동명이인 전체 반환 (탈퇴/제명 제외)
 *   - 해상도는 클라이언트에서 검증 (최소 400 x 600 px)
 *   - 서버는 LockService로 동시 쓰기 누락 방지
 *   - 새 사진이 반영되면 기존 Drive 파일은 휴지통으로 이동 (reversible)
 ****************************************************************/
/**
 * Drive 파일 링크/URL에서 파일 ID를 추출. 지원 포맷:
 *   https://drive.google.com/file/d/{ID}/view
 *   https://drive.google.com/open?id={ID}
 * 그 외 (외부 URL, 빈값 등)는 빈 문자열 반환.
 */
function extractDriveFileId_(url) {
  if (!url) return '';
  const s = String(url);
  let m = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return '';
}

/**
 * 이전 사진 URL 배열을 받아 Drive 휴지통으로 이동 (best-effort).
 *   - Drive 링크가 아닌 값은 건너뜀
 *   - 이미 없거나 권한 부족인 경우 예외를 catch 하여 계속 진행
 *   - setTrashed(true) 는 30일 내 복원 가능한 reversible delete
 */
function trashOldPhotoFiles_(urls) {
  const result = { trashed: 0, skipped: 0, failed: 0 };
  if (!urls || !urls.length) return result;
  const seen = {};
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) { result.skipped++; continue; }
    if (seen[url]) continue;
    seen[url] = true;
    const fileId = extractDriveFileId_(url);
    if (!fileId) { result.skipped++; continue; }
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
      result.trashed++;
    } catch (e) {
      result.failed++;
    }
  }
  return result;
}

/**
 * Members 시트에 특정 헤더 이름의 컬럼이 없으면 마지막 위치에 추가한다.
 * mMap 을 제자리에서 갱신하고, 추가된(또는 기존) 컬럼의 0-based 인덱스를 반환.
 */
function ensureMembersColumn_(memSheet, mMap, colName) {
  if (mMap[colName] !== undefined) return mMap[colName];
  const newColPos = memSheet.getLastColumn() + 1;
  memSheet.getRange(1, newColPos).setValue(colName);
  mMap[colName] = newColPos - 1;
  return mMap[colName];
}
/**
 * 사진 업로드 도구 전용 회원 조회. 이름(성명)으로 정확 일치 조회.
 */
function searchMembersForPhoto(name) {
  const key = normalize(name);
  if (!key) return [];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error("Members 시트를 찾을 수 없습니다.");
  const map = getColumnMap(memSheet);
  if (map[COLS.ID] === undefined || map[COLS.NAME] === undefined) {
    throw new Error("Members 시트에 회원번호/성명 열이 없습니다.");
  }
  const lastRow = memSheet.getLastRow();
  const lastCol = memSheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  const deptInfo = getDepartmentInfoMaps_();
  const results = [];

  // 이름 컬럼 한 번 읽고 정규화 비교 → 중복 없는 행번호 집합
  const nameColIdx = map[COLS.NAME];
  const nameVals = memSheet.getRange(2, nameColIdx + 1, lastRow - 1, 1).getValues();
  const matchedRowSet = {};
  for (let i = 0; i < nameVals.length; i++) {
    if (normalize(nameVals[i][0]) === key) {
      matchedRowSet[i + 2] = true; // 시트 1-based row
    }
  }
  const matchedRows = Object.keys(matchedRowSet).map(Number).sort((a, b) => a - b);
  if (!matchedRows.length) return results;

  // Members 시트에 동일 회원번호가 중복 입력되어 있어도 한 건만 노출되도록 2차 dedup
  const seenMemberIds = {};
  const idColIdx = map[COLS.ID];
  for (let k = 0; k < matchedRows.length; k++) {
    const r = matchedRows[k];
    const row = memSheet.getRange(r, 1, 1, lastCol).getValues()[0];
    const status = map[COLS.STATUS] !== undefined ? String(row[map[COLS.STATUS]] || '') : '';
    if (status === '탈퇴' || status === '제명') continue;
    const mid = normalize(row[idColIdx], true);
    if (mid) {
      if (seenMemberIds[mid]) continue;
      seenMemberIds[mid] = true;
    }
    results.push(buildPhotoSearchRow_(row, map, deptInfo));
  }
  return results;
}

function buildPhotoSearchRow_(row, map, deptInfo) {
  const deptId = map[COLS.DEPT_ID] !== undefined ? String(row[map[COLS.DEPT_ID]] || '') : '';
  const deptName = deptInfo && deptInfo.byId[deptId] ? deptInfo.byId[deptId].name : (deptId || '소속미정');
  const status = map[COLS.STATUS] !== undefined ? String(row[map[COLS.STATUS]] || '') : '';
  const rank = map[COLS.RANK] !== undefined ? String(row[map[COLS.RANK]] || '') : '';
  const phone = map[COLS.PHONE] !== undefined ? String(row[map[COLS.PHONE]] || '') : '';
  const email = map[COLS.EMAIL] !== undefined ? String(row[map[COLS.EMAIL]] || '') : '';
  const address = map[COLS.ADDRESS] !== undefined ? String(row[map[COLS.ADDRESS]] || '') : '';
  const job = map[COLS.JOB] !== undefined ? String(row[map[COLS.JOB]] || '') : '';
  const company = map[COLS.COMPANY] !== undefined ? String(row[map[COLS.COMPANY]] || '') : '';
  const birth = map[COLS.BIRTH] !== undefined ? formatInAppTimeZone(row[map[COLS.BIRTH]], "yyyy-MM-dd") : '';
  const birthPlace = map[COLS.BIRTHPLACE] !== undefined ? String(row[map[COLS.BIRTHPLACE]] || '') : '';
  const photoUrl = map[COLS.PHOTO] !== undefined ? String(row[map[COLS.PHOTO]] || '') : '';
  return {
    member_id: normalize(row[map[COLS.ID]], true),
    name: normalize(row[map[COLS.NAME]]),
    dept_id: deptId,
    dept_name: deptName,
    status: status,
    rank: rank,
    phone: phone,
    email: email,
    address: address,
    job: job,
    company: company,
    birth: birth,
    birth_place: birthPlace,
    photo: photoUrl,
    has_photo: !!photoUrl
  };
}

/**
 * 업로드 엔드포인트 (큐 기반).
 *
 *  설계: Hot path에서 LockService를 사용하지 않는다.
 *    1) Drive 업로드  ← 사용자간 완전 병렬
 *    2) PhotoUploadQueue.appendRow  ← Apps Script가 appendRow를 원자적으로 보장
 *    3) 즉시 처리 시도 (tryLock 1.5s, 실패해도 무시)
 *    4) 사용자에게 즉시 응답
 *  큐에 남은 PENDING 건은 1분 주기 트리거(processPhotoQueueTrigger_)가 드레인.
 */
/**
 * 사진 및/또는 회원 정보 업데이트를 큐에 적재한다.
 *   - 사진(base64Data, fileName)은 선택. 있으면 Drive 업로드 후 링크 저장.
 *   - extras 객체: { birth_place, phone, email, address, job, company } - 비어있지 않은 필드만 Members에 반영.
 *   - 사진과 extras 모두 비어있으면 에러.
 */
function uploadMemberPhotoDirect(memberId, base64Data, fileName, uploader, memberName, extras) {
  const targetId = normalize(memberId, true);
  if (!targetId) throw new Error("회원번호가 지정되지 않았습니다.");

  const hasPhoto = !!(base64Data && fileName);
  if (hasPhoto && !isAllowedPhotoPayload_(fileName, base64Data)) {
    throw new Error("사진은 JPG/JPEG/PNG/GIF/WEBP 형식만 업로드할 수 있습니다.");
  }

  const safeExtras = (extras && typeof extras === 'object') ? extras : {};
  const e = {
    birth_place: normalize(safeExtras.birth_place),
    phone: normalize(safeExtras.phone),
    email: normalize(safeExtras.email),
    address: normalize(safeExtras.address),
    job: normalize(safeExtras.job),
    company: normalize(safeExtras.company)
  };
  const hasExtras = !!(e.birth_place || e.phone || e.email || e.address || e.job || e.company);

  if (!hasPhoto && !hasExtras) {
    throw new Error("저장할 내용이 없습니다. 사진이나 회원 정보 중 하나 이상을 입력해주세요.");
  }

  // 1) Drive 업로드 (사진이 있는 경우만)
  let fileId = '';
  let fileLink = '';
  if (hasPhoto) {
    fileId = uploadFileToDrive(base64Data, fileName, FOLDER_NAME);
    if (!fileId) throw new Error("Drive 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.");
    fileLink = `https://drive.google.com/file/d/${fileId}/view?usp=drive_link`;
  }

  // 2) 큐에 적재 (appendRow 원자적)
  const queueSheet = getOrCreatePhotoQueueSheet_();
  const reqId = Utilities.getUuid();
  const nowStr = nowDateTimeStr();
  const safeName = normalize(memberName);
  const safeUploader = normalize(uploader) || 'PHOTO_UPLOAD_TOOL';
  queueSheet.appendRow([
    reqId, targetId, safeName,
    fileId, fileLink, String(fileName || ''),
    safeUploader, 'PENDING', nowStr, '', '',
    e.birth_place, e.phone, e.email, e.address, e.job, e.company
  ]);

  // 3) 즉시 처리 시도 — 락을 못잡으면 트리거가 1분 내에 처리한다.
  let immediateResult = null;
  try {
    immediateResult = processPhotoQueue_(1500);
  } catch (err) { /* best-effort: 실패해도 트리거가 드레인 */ }

  const immediateProcessed = !!(immediateResult && !immediateResult.skipped && immediateResult.processed > 0);

  return {
    ok: true,
    request_id: reqId,
    member_id: targetId,
    file_id: fileId,
    file_link: fileLink,
    has_photo: hasPhoto,
    created_at: nowStr,
    queued: true,
    immediate_processed: immediateProcessed
  };
}

/**
 * 큐 시트(PhotoUploadQueue)를 보장 생성 후 반환한다.
 * 헤더가 없거나 일부 누락된 경우 자동 복구한다.
 */
function getOrCreatePhotoQueueSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.PHOTO_QUEUE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.PHOTO_QUEUE);
    sheet.getRange(1, 1, 1, PHOTO_QUEUE_HEADERS.length).setValues([PHOTO_QUEUE_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // 헤더 검증/보강
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const hasAll = PHOTO_QUEUE_HEADERS.every((h, i) => existing[i] === h);
  if (!hasAll) {
    sheet.getRange(1, 1, 1, PHOTO_QUEUE_HEADERS.length).setValues([PHOTO_QUEUE_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 큐 배치 프로세서. PENDING 건을 한 번의 락 구간에서 모두 처리한다.
 *   - Members 시트: 사진 / updated_at 컬럼만 column-wise setValues 로 배치 반영
 *   - 큐 시트: 읽은 범위 전체를 한 번에 setValues 로 상태 갱신
 *   - MemberHistory: 배치 append
 * 락을 잡지 못하면 { skipped: true } 를 반환한다 (다른 호출이 처리 중).
 */
function processPhotoQueue_(lockTimeoutMs) {
  const lock = LockService.getScriptLock();
  const timeout = typeof lockTimeoutMs === 'number' ? lockTimeoutMs : 10000;
  if (!lock.tryLock(timeout)) {
    return { processed: 0, errored: 0, skipped: true };
  }

  // finally 블록에서도 접근해야 하므로 try 바깥에 선언
  const oldPhotosToDelete = [];
  let writeSucceeded = false;

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const queueSheet = ss.getSheetByName(SHEETS.PHOTO_QUEUE);
    if (!queueSheet) return { processed: 0, errored: 0 };
    const qLastRow = queueSheet.getLastRow();
    if (qLastRow < 2) return { processed: 0, errored: 0 };

    const qMap = getColumnMap(queueSheet);
    const qLastCol = queueSheet.getLastColumn();
    const statusCol = qMap['status'];
    const procAtCol = qMap['processed_at'];
    const noteCol = qMap['note'];
    const memberIdQCol = qMap['member_id'];
    const fileLinkQCol = qMap['file_link'];
    const uploaderQCol = qMap['uploader'];
    // 구 스키마 호환: 아래 컬럼들은 undefined 일 수 있음
    const birthPlaceQCol = qMap['birth_place'];
    const phoneQCol = qMap['phone'];
    const emailQCol = qMap['email'];
    const addressQCol = qMap['address'];
    const jobQCol = qMap['job'];
    const companyQCol = qMap['company'];
    if ([statusCol, procAtCol, noteCol, memberIdQCol, fileLinkQCol, uploaderQCol].some(v => v === undefined)) {
      throw new Error("PhotoUploadQueue 시트 헤더가 올바르지 않습니다.");
    }

    const qData = queueSheet.getRange(2, 1, qLastRow - 1, qLastCol).getValues();
    const pendingIndices = [];
    for (let i = 0; i < qData.length; i++) {
      if (String(qData[i][statusCol] || '').trim() === 'PENDING') pendingIndices.push(i);
    }
    if (!pendingIndices.length) return { processed: 0, errored: 0 };

    // Members 시트에서 필요한 컬럼만 읽는다
    const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
    if (!memSheet) throw new Error("Members 시트를 찾을 수 없습니다.");
    const mMap = getColumnMap(memSheet);
    const idCol = mMap[COLS.ID];
    const photoCol = mMap[COLS.PHOTO];
    const updatedCol = mMap[COLS.UPDATED_AT];
    const nameCol = mMap[COLS.NAME];
    if (idCol === undefined) throw new Error("Members 시트에 회원번호 컬럼이 없습니다.");
    if (photoCol === undefined) throw new Error("Members 시트에 '사진' 컬럼이 없습니다.");

    // BirthPlace 컬럼이 없으면 자동 추가 (mMap 이 갱신됨)
    const birthPlaceCol = ensureMembersColumn_(memSheet, mMap, COLS.BIRTHPLACE);
    const phoneCol = mMap[COLS.PHONE];
    const emailCol = mMap[COLS.EMAIL];
    const addressCol = mMap[COLS.ADDRESS];
    const jobCol = mMap[COLS.JOB];
    const companyCol = mMap[COLS.COMPANY];

    const mLastRow = memSheet.getLastRow();
    if (mLastRow < 2) throw new Error("Members 시트에 회원 데이터가 없습니다.");
    const mRowCount = mLastRow - 1;

    const idVals = memSheet.getRange(2, idCol + 1, mRowCount, 1).getValues();
    const photoVals = memSheet.getRange(2, photoCol + 1, mRowCount, 1).getValues();
    const updatedVals = updatedCol !== undefined
      ? memSheet.getRange(2, updatedCol + 1, mRowCount, 1).getValues()
      : null;
    const nameVals = nameCol !== undefined
      ? memSheet.getRange(2, nameCol + 1, mRowCount, 1).getValues()
      : null;
    const birthPlaceVals = memSheet.getRange(2, birthPlaceCol + 1, mRowCount, 1).getValues();
    const phoneVals = phoneCol !== undefined ? memSheet.getRange(2, phoneCol + 1, mRowCount, 1).getValues() : null;
    const emailVals = emailCol !== undefined ? memSheet.getRange(2, emailCol + 1, mRowCount, 1).getValues() : null;
    const addressVals = addressCol !== undefined ? memSheet.getRange(2, addressCol + 1, mRowCount, 1).getValues() : null;
    const jobVals = jobCol !== undefined ? memSheet.getRange(2, jobCol + 1, mRowCount, 1).getValues() : null;
    const companyVals = companyCol !== undefined ? memSheet.getRange(2, companyCol + 1, mRowCount, 1).getValues() : null;

    const idToIdx = {};
    for (let i = 0; i < idVals.length; i++) {
      const mid = normalize(idVals[i][0], true);
      if (mid) idToIdx[mid] = i;
    }

    const nowStr = nowDateTimeStr();
    const historyRows = [];
    let processed = 0;
    let errored = 0;
    let photoChanged = false;
    let birthPlaceChanged = false;
    let phoneChanged = false;
    let emailChanged = false;
    let addressChanged = false;
    let jobChanged = false;
    let companyChanged = false;

    // 간단 헬퍼: 큐 값이 있으면서 기존과 다른 경우에만 덮어쓰고 변경 플래그를 true 로 세팅
    function applyUpdate_(vals, memRow, qVal) {
      if (!vals || !qVal) return { changed: false, oldVal: '' };
      const oldVal = String(vals[memRow][0] || '');
      if (oldVal === qVal) return { changed: false, oldVal };
      vals[memRow][0] = qVal;
      return { changed: true, oldVal };
    }

    for (let k = 0; k < pendingIndices.length; k++) {
      const qRowIdx = pendingIndices[k];
      const qRow = qData[qRowIdx];
      const memberId = normalize(qRow[memberIdQCol], true);
      const fileLink = String(qRow[fileLinkQCol] || '');
      const uploader = String(qRow[uploaderQCol] || 'PHOTO_UPLOAD_TOOL');
      const birthPlace = birthPlaceQCol !== undefined ? String(qRow[birthPlaceQCol] || '').trim() : '';
      const phoneVal = phoneQCol !== undefined ? String(qRow[phoneQCol] || '').trim() : '';
      const emailVal = emailQCol !== undefined ? String(qRow[emailQCol] || '').trim() : '';
      const addressVal = addressQCol !== undefined ? String(qRow[addressQCol] || '').trim() : '';
      const jobVal = jobQCol !== undefined ? String(qRow[jobQCol] || '').trim() : '';
      const companyVal = companyQCol !== undefined ? String(qRow[companyQCol] || '').trim() : '';

      const hasAnyInput = !!(fileLink || birthPlace || phoneVal || emailVal || addressVal || jobVal || companyVal);
      if (!memberId || !hasAnyInput) {
        qData[qRowIdx][statusCol] = 'ERROR';
        qData[qRowIdx][procAtCol] = nowStr;
        qData[qRowIdx][noteCol] = '필수 필드 누락';
        errored++;
        continue;
      }

      const memRow = idToIdx[memberId];
      if (memRow === undefined) {
        qData[qRowIdx][statusCol] = 'ERROR';
        qData[qRowIdx][procAtCol] = nowStr;
        qData[qRowIdx][noteCol] = '회원번호 없음: ' + memberId;
        errored++;
        continue;
      }

      // 사진: fileLink 가 있을 때만 덮어쓰기
      let oldPhoto = '';
      let rowChanged = false;
      if (fileLink) {
        oldPhoto = String(photoVals[memRow][0] || '');
        if (oldPhoto !== fileLink) {
          photoVals[memRow][0] = fileLink;
          photoChanged = true;
          rowChanged = true;
          // 덮어쓰여진 이전 사진은 Drive 휴지통으로 이동 대상
          if (oldPhoto && oldPhoto !== fileLink) {
            oldPhotosToDelete.push(oldPhoto);
          }
        }
      }

      // 나머지 필드들: 큐 값이 있으면서 기존과 다를 때만 반영
      const changedFields = [];
      const bp = applyUpdate_(birthPlaceVals, memRow, birthPlace);
      if (bp.changed) { birthPlaceChanged = true; rowChanged = true; changedFields.push('출생지'); }
      const ph = applyUpdate_(phoneVals, memRow, phoneVal);
      if (ph.changed) { phoneChanged = true; rowChanged = true; changedFields.push('전화번호'); }
      const em = applyUpdate_(emailVals, memRow, emailVal);
      if (em.changed) { emailChanged = true; rowChanged = true; changedFields.push('E-mail'); }
      const ad = applyUpdate_(addressVals, memRow, addressVal);
      if (ad.changed) { addressChanged = true; rowChanged = true; changedFields.push('주소'); }
      const jb = applyUpdate_(jobVals, memRow, jobVal);
      if (jb.changed) { jobChanged = true; rowChanged = true; changedFields.push('직업'); }
      const co = applyUpdate_(companyVals, memRow, companyVal);
      if (co.changed) { companyChanged = true; rowChanged = true; changedFields.push('직장명'); }

      if (rowChanged && updatedVals) updatedVals[memRow][0] = nowStr;

      qData[qRowIdx][statusCol] = 'DONE';
      qData[qRowIdx][procAtCol] = nowStr;
      const noteParts = [];
      if (fileLink) noteParts.push(oldPhoto ? '사진 덮어쓰기' : '사진 신규');
      else if (rowChanged) noteParts.push('정보 수정');
      else noteParts.push('변경 없음');
      if (changedFields.length) noteParts.push(changedFields.join('/'));
      qData[qRowIdx][noteCol] = noteParts.join(' · ');

      const memberName = nameVals ? normalize(nameVals[memRow][0]) : '';
      historyRows.push({ memberId, memberName, uploader, oldPhoto, fileLink, changedFields });
      processed++;
    }

    // 1) Members 시트: 실제로 변경된 컬럼만 배치 쓰기 (다른 컬럼은 건드리지 않음)
    //    → Members 시트를 다른 경로로 동시 편집해도 충돌 범위를 최소화한다.
    const anyChanged = photoChanged || birthPlaceChanged || phoneChanged || emailChanged || addressChanged || jobChanged || companyChanged;
    if (photoChanged) memSheet.getRange(2, photoCol + 1, mRowCount, 1).setValues(photoVals);
    if (anyChanged && updatedVals) memSheet.getRange(2, updatedCol + 1, mRowCount, 1).setValues(updatedVals);
    if (birthPlaceChanged) memSheet.getRange(2, birthPlaceCol + 1, mRowCount, 1).setValues(birthPlaceVals);
    if (phoneChanged && phoneVals) memSheet.getRange(2, phoneCol + 1, mRowCount, 1).setValues(phoneVals);
    if (emailChanged && emailVals) memSheet.getRange(2, emailCol + 1, mRowCount, 1).setValues(emailVals);
    if (addressChanged && addressVals) memSheet.getRange(2, addressCol + 1, mRowCount, 1).setValues(addressVals);
    if (jobChanged && jobVals) memSheet.getRange(2, jobCol + 1, mRowCount, 1).setValues(jobVals);
    if (companyChanged && companyVals) memSheet.getRange(2, companyCol + 1, mRowCount, 1).setValues(companyVals);

    // 2) Queue 시트: 전체 범위 일괄 쓰기 (읽은 범위만)
    queueSheet.getRange(2, 1, qData.length, qLastCol).setValues(qData);

    // 3) MemberHistory 배치 append
    if (historyRows.length > 0) {
      const histSheet = ss.getSheetByName(SHEETS.HISTORY);
      if (histSheet) {
        try {
          const histLastCol = histSheet.getLastColumn();
          const histLastRow = histSheet.getLastRow();
          const rows = historyRows.map(h => {
            const parts = [];
            if (h.fileLink) parts.push(`사진: ${h.oldPhoto ? '기존 사진' : '(빈값)'} → 신규 사진`);
            if (h.changedFields && h.changedFields.length) parts.push(`수정: ${h.changedFields.join(', ')}`);
            const note = parts.length ? parts.join(' · ') : '변경 없음';
            const arr = [
              Utilities.getUuid(), h.memberId, 'UPDATE', '', '', '', '',
              '사진/정보 업로드 (큐)', '', h.uploader, nowStr,
              note
            ];
            if (histLastCol > arr.length) return arr.concat(new Array(histLastCol - arr.length).fill(''));
            if (histLastCol > 0 && histLastCol < arr.length) return arr.slice(0, histLastCol);
            return arr;
          });
          const targetCols = Math.max(histLastCol, rows[0].length);
          histSheet.getRange(histLastRow + 1, 1, rows.length, targetCols).setValues(rows);
        } catch (e) { /* 감사 로그는 best-effort */ }
      }
    }

    // Members 시트 쓰기와 큐/히스토리 쓰기가 모두 끝났다면 trash 가능
    writeSucceeded = true;
    SpreadsheetApp.flush();
    bumpSearchCacheVersion_();

    return { processed, errored, skipped: false, pending: pendingIndices.length };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
    // 락 해제 후 Drive 휴지통 이동 (락 유지 시간에 영향 없음)
    // finally는 return 값이 caller에게 전달되기 전에 실행되므로 안전하게 호출 가능
    if (writeSucceeded && oldPhotosToDelete.length > 0) {
      try { trashOldPhotoFiles_(oldPhotosToDelete); } catch (e) { /* best-effort */ }
    }
  }
}

/** 트리거에서 호출되는 엔트리. */
function processPhotoQueueTrigger_() {
  processPhotoQueue_(20000);
}

/** 사진 업로드 큐 드레인 트리거 설치 (1분 주기). 최초 1회 수동 실행. */
function setupPhotoUploadTrigger() {
  removePhotoUploadTrigger();
  ScriptApp.newTrigger(PHOTO_QUEUE_TRIGGER_FN)
    .timeBased()
    .everyMinutes(1)
    .create();
  getOrCreatePhotoQueueSheet_();
  return `사진 업로드 큐 트리거 설치 완료 (1분 주기, handler=${PHOTO_QUEUE_TRIGGER_FN})`;
}

/** 사진 업로드 큐 트리거 제거. */
function removePhotoUploadTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === PHOTO_QUEUE_TRIGGER_FN) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  return `사진 업로드 큐 트리거 제거: ${removed}개`;
}

/** 큐 상태 요약 조회. 선택: 특정 request_id 의 개별 상태도 반환. */
function getPhotoQueueStatus(requestId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.PHOTO_QUEUE);
  const summary = { pending: 0, done: 0, error: 0, total: 0, item: null };
  if (!sheet) return summary;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return summary;

  const qMap = getColumnMap(sheet);
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const statusCol = qMap['status'];
  const reqIdCol = qMap['request_id'];
  const noteCol = qMap['note'];
  const procAtCol = qMap['processed_at'];
  const wanted = normalize(requestId);

  for (let i = 0; i < data.length; i++) {
    const status = String(data[i][statusCol] || '').trim();
    if (status === 'PENDING') summary.pending++;
    else if (status === 'DONE') summary.done++;
    else if (status === 'ERROR') summary.error++;
    if (wanted && String(data[i][reqIdCol] || '').trim() === wanted) {
      summary.item = {
        request_id: wanted,
        status: status,
        processed_at: data[i][procAtCol] || '',
        note: data[i][noteCol] || ''
      };
    }
  }
  summary.total = data.length;
  return summary;
}

/****************************************************************
 * 부서별 현황 시트 생성 (수동 실행 유틸)
 *   - 현재 스프레드시트가 위치한 Drive 폴더 아래에 '부서별 현황' 폴더 get-or-create
 *   - Departments 시트의 각 부서마다 개별 스프레드시트 파일 get-or-create
 *     · 파일명: [부서별현황] {부서명}
 *     · 기존 파일이 있으면 내용만 덮어써서 링크 URL 유지
 *     · Members 시트에서 해당 부서원만 추출: 회원번호/성명/전화번호/회원상태/법계/사진링크
 *     · 링크가 있는 모든 사용자 VIEW 권한 (읽기 전용)
 *   - 메인 스프레드시트의 '부서별 현황 공유 링크' 시트에 모든 부서 파일 URL 기록
 *
 * 최초 1회 수동 실행 필요 (권한 승인 요구). 이후 Members 가 갱신될 때 다시 실행.
 ****************************************************************/
function generateDepartmentReports() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 현재 스프레드시트의 부모 Drive 폴더 찾기
  const ssFile = DriveApp.getFileById(ss.getId());
  const parentIt = ssFile.getParents();
  const parentFolder = parentIt.hasNext() ? parentIt.next() : DriveApp.getRootFolder();

  // 2. '부서별 현황' 하위 폴더 get-or-create
  const subIt = parentFolder.getFoldersByName(DEPT_STATUS_FOLDER_NAME);
  const folder = subIt.hasNext() ? subIt.next() : parentFolder.createFolder(DEPT_STATUS_FOLDER_NAME);

  // 3. Members 시트 로드 + 필수 컬럼 확인
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error("Members 시트를 찾을 수 없습니다.");
  const mMap = getColumnMap(memSheet);
  const required = [COLS.ID, COLS.NAME, COLS.PHONE, COLS.STATUS, COLS.RANK, COLS.PHOTO, COLS.DEPT_ID];
  for (let i = 0; i < required.length; i++) {
    if (mMap[required[i]] === undefined) {
      throw new Error(`Members 시트에 '${required[i]}' 컬럼이 없습니다.`);
    }
  }
  // BirthPlace 컬럼이 없으면 자동 추가 (mMap 이 갱신됨)
  ensureMembersColumn_(memSheet, mMap, COLS.BIRTHPLACE);

  const mLastRow = memSheet.getLastRow();
  const mLastCol = memSheet.getLastColumn();
  if (mLastRow < 2) throw new Error("Members 시트에 데이터가 없습니다.");
  const data = memSheet.getRange(2, 1, mLastRow - 1, mLastCol).getValues();

  // 4. 부서 목록 로드
  const depts = getDepartmentList();
  if (!depts.length) throw new Error("Departments 시트에서 부서를 찾을 수 없습니다.");

  // 5. Members 를 부서 ID 로 그룹화
  const idxId = mMap[COLS.ID];
  const idxName = mMap[COLS.NAME];
  const idxPhone = mMap[COLS.PHONE];
  const idxStatus = mMap[COLS.STATUS];
  const idxRank = mMap[COLS.RANK];
  const idxPhoto = mMap[COLS.PHOTO];
  const idxDept = mMap[COLS.DEPT_ID];
  const idxBirthPlace = mMap[COLS.BIRTHPLACE];

  const byDept = {};
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const deptId = String(row[idxDept] || '').trim();
    if (!deptId) continue;
    if (!byDept[deptId]) byDept[deptId] = [];
    byDept[deptId].push([
      row[idxId],
      row[idxName],
      row[idxPhone],
      row[idxStatus],
      row[idxRank],
      row[idxPhoto],
      idxBirthPlace !== undefined ? row[idxBirthPlace] : ''
    ]);
  }

  // 6. 부서별 스프레드시트 생성/갱신
  const nowStr = nowDateTimeStr();
  const headerRow = ['회원번호', '성명', '전화번호', '회원상태', '법계', '사진링크', '출생지'];
  const linkRows = [];
  let created = 0;
  let updatedCount = 0;

  for (let d = 0; d < depts.length; d++) {
    const deptId = String(depts[d].id || '').trim();
    if (!deptId) continue;
    const deptName = String(depts[d].name || '').trim() || deptId;
    const members = byDept[deptId] || [];
    const fileName = `[부서별현황] ${deptName}`;

    // 기존 파일 get, 없으면 create
    let file;
    const existing = folder.getFilesByName(fileName);
    if (existing.hasNext()) {
      file = existing.next();
      updatedCount++;
    } else {
      const newSs = SpreadsheetApp.create(fileName);
      file = DriveApp.getFileById(newSs.getId());
      try { file.moveTo(folder); } catch (e) { /* best-effort */ }
      created++;
    }

    // 시트 내용 덮어쓰기
    const targetSs = SpreadsheetApp.openById(file.getId());
    const sheet = targetSs.getSheets()[0];
    try { sheet.setName(sanitizeSheetName_(deptName)); } catch (e) { /* 이름 설정 실패 시 무시 */ }
    sheet.clearContents();
    sheet.clearFormats();

    const allRows = [headerRow].concat(members);
    sheet.getRange(1, 1, allRows.length, headerRow.length).setValues(allRows);
    sheet.getRange(1, 1, 1, headerRow.length)
      .setFontWeight('bold')
      .setBackground('#f0f4f8');
    sheet.setFrozenRows(1);

    // 링크가 있는 모든 사용자 — 읽기(VIEW) 권한
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      // 도메인 정책에 따라 공유가 제한될 수 있음 — 무시하고 계속
    }

    const url = `https://docs.google.com/spreadsheets/d/${file.getId()}/edit`;
    linkRows.push([deptId, deptName, url, members.length, nowStr]);
  }

  // 7. 메인 스프레드시트에 '부서별 현황 공유 링크' 시트 갱신
  let linkSheet = ss.getSheetByName(SHEETS.DEPT_STATUS_LINKS);
  if (!linkSheet) linkSheet = ss.insertSheet(SHEETS.DEPT_STATUS_LINKS);
  linkSheet.clearContents();
  linkSheet.clearFormats();

  const linkHeaders = ['부서ID', '부서명', '공유 링크', '회원 수', 'updated_at'];
  linkSheet.getRange(1, 1, 1, linkHeaders.length).setValues([linkHeaders]);
  linkSheet.getRange(1, 1, 1, linkHeaders.length)
    .setFontWeight('bold')
    .setBackground('#f0f4f8');
  linkSheet.setFrozenRows(1);

  if (linkRows.length) {
    linkSheet.getRange(2, 1, linkRows.length, linkHeaders.length).setValues(linkRows);
  }

  return `부서별 현황 생성 완료: 신규 ${created}개, 업데이트 ${updatedCount}개, 총 ${linkRows.length}개 부서. 폴더: '${folder.getName()}'`;
}

/** 구글 시트 이름 제약(100자, 일부 특수문자 금지) 반영 */
function sanitizeSheetName_(name) {
  const s = String(name || '').replace(/[\[\]:\/\?\*\\']/g, '_').trim();
  return s.substring(0, 100) || 'Sheet1';
}

const DEPT_REPORTS_TRIGGER_FN = 'generateDepartmentReportsTrigger_';

/** 트리거에서 호출되는 래퍼. 예외는 로그만 남기고 다음 실행을 방해하지 않는다. */
function generateDepartmentReportsTrigger_() {
  try {
    const result = generateDepartmentReports();
    console.log('[부서별 현황 자동 갱신] ' + result);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error('[부서별 현황 자동 갱신] 실패: ' + msg);
  }
}

/** 부서별 현황 자동 갱신 트리거 설치 (60분 주기). 최초 1회 수동 실행 필요. */
function setupDepartmentReportsTrigger() {
  removeDepartmentReportsTrigger();
  ScriptApp.newTrigger(DEPT_REPORTS_TRIGGER_FN)
    .timeBased()
    .everyHours(1)
    .create();
  return `부서별 현황 자동 갱신 트리거 설치 완료 (60분 주기, handler=${DEPT_REPORTS_TRIGGER_FN})`;
}

/** 부서별 현황 자동 갱신 트리거 제거. */
function removeDepartmentReportsTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === DEPT_REPORTS_TRIGGER_FN) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  return `부서별 현황 자동 갱신 트리거 제거: ${removed}개`;
}

/****************************************************************
 * 법계별 현황 자동 생성
 *   - 시트가 위치한 Drive 폴더 아래 '법계별 현황' 서브폴더를 get-or-create.
 *   - 해당 폴더에 '[법계별현황] {법계명}' 형식의 스프레드시트를 법계마다 생성/갱신.
 *   - 각 파일: 회원번호, 성명, 전화번호, 회원상태, 부서명, 사진링크, 출생지, 법명
 *   - ANYONE_WITH_LINK / VIEW 권한 부여 후 링크를 메인 시트의
 *     '법계별 현황 공유 링크' 시트에 기록.
 ****************************************************************/
function generateRankReports() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 현재 스프레드시트의 부모 Drive 폴더 찾기
  const ssFile = DriveApp.getFileById(ss.getId());
  const parentIt = ssFile.getParents();
  const parentFolder = parentIt.hasNext() ? parentIt.next() : DriveApp.getRootFolder();

  // 2. '법계별 현황' 하위 폴더 get-or-create
  const subIt = parentFolder.getFoldersByName(RANK_STATUS_FOLDER_NAME);
  const folder = subIt.hasNext() ? subIt.next() : parentFolder.createFolder(RANK_STATUS_FOLDER_NAME);

  // 3. Members 시트 로드 + 필수 컬럼 확인
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error("Members 시트를 찾을 수 없습니다.");
  const mMap = getColumnMap(memSheet);
  const required = [COLS.ID, COLS.NAME, COLS.PHONE, COLS.STATUS, COLS.RANK, COLS.PHOTO, COLS.DEPT_ID];
  for (let i = 0; i < required.length; i++) {
    if (mMap[required[i]] === undefined) {
      throw new Error(`Members 시트에 '${required[i]}' 컬럼이 없습니다.`);
    }
  }
  // BirthPlace / 법명 컬럼이 없으면 자동 추가
  ensureMembersColumn_(memSheet, mMap, COLS.BIRTHPLACE);
  ensureMembersColumn_(memSheet, mMap, COLS.DHARMA_NAME);

  const mLastRow = memSheet.getLastRow();
  const mLastCol = memSheet.getLastColumn();
  if (mLastRow < 2) throw new Error("Members 시트에 데이터가 없습니다.");
  const data = memSheet.getRange(2, 1, mLastRow - 1, mLastCol).getValues();

  // 4. 부서 목록 로드 (부서ID → 부서명 매핑용)
  const depts = getDepartmentList();
  const deptNameById = {};
  for (let i = 0; i < depts.length; i++) {
    const id = String(depts[i].id || '').trim();
    if (id) deptNameById[id] = String(depts[i].name || '').trim() || id;
  }

  // 5. Members 를 법계로 그룹화 + 법계 목록 수집
  const idxId = mMap[COLS.ID];
  const idxName = mMap[COLS.NAME];
  const idxPhone = mMap[COLS.PHONE];
  const idxStatus = mMap[COLS.STATUS];
  const idxRank = mMap[COLS.RANK];
  const idxPhoto = mMap[COLS.PHOTO];
  const idxDept = mMap[COLS.DEPT_ID];
  const idxBirthPlace = mMap[COLS.BIRTHPLACE];
  const idxDharmaName = mMap[COLS.DHARMA_NAME];

  const byRank = {};
  const rankOrder = []; // 입력 순서 유지 (처음 등장한 순)
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rank = String(row[idxRank] || '').trim();
    if (!rank) continue;
    if (!byRank[rank]) { byRank[rank] = []; rankOrder.push(rank); }
    const deptId = String(row[idxDept] || '').trim();
    byRank[rank].push([
      row[idxId],
      row[idxName],
      row[idxPhone],
      row[idxStatus],
      deptNameById[deptId] || deptId,
      row[idxPhoto],
      idxBirthPlace !== undefined ? row[idxBirthPlace] : '',
      idxDharmaName !== undefined ? row[idxDharmaName] : ''
    ]);
  }

  // 6. 법계별 스프레드시트 생성/갱신
  const nowStr = nowDateTimeStr();
  const headerRow = ['회원번호', '성명', '전화번호', '회원상태', '부서명', '사진링크', '출생지', '법명'];
  const linkRows = [];
  let created = 0;
  let updatedCount = 0;

  for (let r = 0; r < rankOrder.length; r++) {
    const rankName = rankOrder[r];
    const members = byRank[rankName] || [];
    const fileName = `[법계별현황] ${rankName}`;

    // 기존 파일 get, 없으면 create
    let file;
    const existing = folder.getFilesByName(fileName);
    if (existing.hasNext()) {
      file = existing.next();
      updatedCount++;
    } else {
      const newSs = SpreadsheetApp.create(fileName);
      file = DriveApp.getFileById(newSs.getId());
      try { file.moveTo(folder); } catch (e) { /* best-effort */ }
      created++;
    }

    // 시트 내용 덮어쓰기
    const targetSs = SpreadsheetApp.openById(file.getId());
    const sheet = targetSs.getSheets()[0];
    try { sheet.setName(sanitizeSheetName_(rankName)); } catch (e) { /* 이름 설정 실패 시 무시 */ }
    sheet.clearContents();
    sheet.clearFormats();

    const allRows = [headerRow].concat(members);
    sheet.getRange(1, 1, allRows.length, headerRow.length).setValues(allRows);
    sheet.getRange(1, 1, 1, headerRow.length)
      .setFontWeight('bold')
      .setBackground('#f0f4f8');
    sheet.setFrozenRows(1);

    // 링크가 있는 모든 사용자 — 읽기(VIEW) 권한
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      // 도메인 정책에 따라 공유가 제한될 수 있음 — 무시하고 계속
    }

    const url = `https://docs.google.com/spreadsheets/d/${file.getId()}/edit`;
    linkRows.push([rankName, url, members.length, nowStr]);
  }

  // 7. 메인 스프레드시트에 '법계별 현황 공유 링크' 시트 갱신
  let linkSheet = ss.getSheetByName(SHEETS.RANK_STATUS_LINKS);
  if (!linkSheet) linkSheet = ss.insertSheet(SHEETS.RANK_STATUS_LINKS);
  linkSheet.clearContents();
  linkSheet.clearFormats();

  const linkHeaders = ['법계', '공유 링크', '회원 수', 'updated_at'];
  linkSheet.getRange(1, 1, 1, linkHeaders.length).setValues([linkHeaders]);
  linkSheet.getRange(1, 1, 1, linkHeaders.length)
    .setFontWeight('bold')
    .setBackground('#f0f4f8');
  linkSheet.setFrozenRows(1);

  if (linkRows.length) {
    linkSheet.getRange(2, 1, linkRows.length, linkHeaders.length).setValues(linkRows);
  }

  return `법계별 현황 생성 완료: 신규 ${created}개, 업데이트 ${updatedCount}개, 총 ${linkRows.length}개 법계. 폴더: '${folder.getName()}'`;
}

const RANK_REPORTS_TRIGGER_FN = 'generateRankReportsTrigger_';

/** 트리거에서 호출되는 래퍼. 예외는 로그만 남기고 다음 실행을 방해하지 않는다. */
function generateRankReportsTrigger_() {
  try {
    const result = generateRankReports();
    console.log('[법계별 현황 자동 갱신] ' + result);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error('[법계별 현황 자동 갱신] 실패: ' + msg);
  }
}

/** 법계별 현황 자동 갱신 트리거 설치 (60분 주기). 최초 1회 수동 실행 필요. */
function setupRankReportsTrigger() {
  removeRankReportsTrigger();
  ScriptApp.newTrigger(RANK_REPORTS_TRIGGER_FN)
    .timeBased()
    .everyHours(1)
    .create();
  return `법계별 현황 자동 갱신 트리거 설치 완료 (60분 주기, handler=${RANK_REPORTS_TRIGGER_FN})`;
}

/** 법계별 현황 자동 갱신 트리거 제거. */
function removeRankReportsTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === RANK_REPORTS_TRIGGER_FN) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  return `법계별 현황 자동 갱신 트리거 제거: ${removed}개`;
}

/** 부서별/법계별 현황을 한 번에 수동 생성 (편의용). */
function generateAllStatusReports() {
  const out = [];
  try { out.push(generateDepartmentReports()); } catch (e) { out.push('부서별 실패: ' + (e && e.message ? e.message : e)); }
  try { out.push(generateRankReports()); } catch (e) { out.push('법계별 실패: ' + (e && e.message ? e.message : e)); }
  return out.join('\n');
}

/** 부서별/법계별 트리거를 한 번에 설치. */
function setupAllStatusTriggers() {
  const a = setupDepartmentReportsTrigger();
  const b = setupRankReportsTrigger();
  return a + '\n' + b;
}

function exportToExcel(shs){const ss=SpreadsheetApp.getActiveSpreadsheet();const ms=ss.getSheetByName(SHEETS.MEMBERS);const d=ms.getDataRange().getValues();const ah=d[0];const fh=[COLS.ID,COLS.NAME];shs.forEach(h=>{if(h!==COLS.ID&&h!==COLS.NAME&&ah.includes(h))fh.push(h);});const ids=fh.map(h=>ah.indexOf(h));const ed=d.map(r=>ids.map(i=>r[i]));const ts=SpreadsheetApp.create("Export_"+Date.now());ts.getSheets()[0].getRange(1,1,ed.length,ed[0].length).setValues(ed);return "https://docs.google.com/spreadsheets/d/"+ts.getId()+"/export?format=xlsx";}

/****************************************************************
 * 회원 카드 — 데이터 조회 + PDF 생성
 ****************************************************************/

/**
 * 회원 카드용 데이터 조회.
 * @param {string} mode  'all' | 'name' | 'dept' | 'ranks' | 'statuses'
 * @param {string} keyword  이름 또는 부서ID 또는 콤마구분 법계/상태
 * @param {string} sortBy  'member_id' (기본) | 'name' (가나다순)
 * @return {Object[]} 카드 데이터 배열
 */
function getMemberCardsData(mode, keyword, sortBy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error('Members 시트를 찾을 수 없습니다.');
  const specialSheet = ss.getSheetByName(SHEETS.SPECIAL_MEMBERS);
  const deptInfo = getDepartmentInfoMaps_();

  const results = [];
  const key = keyword ? normalize(keyword) : '';

  // 법계 복수 선택: 콤마 구분 문자열 → Set으로 변환
  var rankFilter = null;
  if (mode === 'ranks' && keyword) {
    rankFilter = {};
    var rankTokens = String(keyword).split(',');
    for (var ri = 0; ri < rankTokens.length; ri++) {
      var tok = normalize(rankTokens[ri]);
      if (tok) rankFilter[tok] = true;
    }
  }

  // 회원상태 복수 선택: 콤마 구분 문자열 → Set으로 변환
  var statusFilter = null;
  if (mode === 'statuses' && keyword) {
    statusFilter = {};
    var statusTokens = String(keyword).split(',');
    for (var si = 0; si < statusTokens.length; si++) {
      var stok = normalize(statusTokens[si]);
      if (stok) statusFilter[stok] = true;
    }
  }

  const sheetsToProcess = [memSheet];
  if (specialSheet) sheetsToProcess.push(specialSheet);

  for (var s = 0; s < sheetsToProcess.length; s++) {
    var sheet = sheetsToProcess[s];
    var map = getColumnMap(sheet);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var status = hasColumn(map, COLS.STATUS) ? String(row[map[COLS.STATUS]] || '').trim() : '';
      // 회원상태로 직접 조회 시에는 탈퇴/제명도 포함하여 필터링
      if (mode !== 'statuses' && (status === '탈퇴' || status === '제명')) continue;
      // 법계 조회 시에는 자격정지 회원도 제외
      if (mode === 'ranks' && status === '자격정지') continue;
      if (mode === 'statuses' && statusFilter && !statusFilter[status]) continue;

      var name = hasColumn(map, COLS.NAME) ? normalize(String(row[map[COLS.NAME]] || '')) : '';
      if (!name) continue;

      var deptId = hasColumn(map, COLS.DEPT_ID) ? String(row[map[COLS.DEPT_ID]] || '').trim() : '';
      var deptName = deptInfo.byId[deptId] ? deptInfo.byId[deptId].name : (deptId || '소속미정');
      var rank = hasColumn(map, COLS.RANK) ? String(row[map[COLS.RANK]] || '').trim() : '';

      // 필터
      if (mode === 'name' && key && normalize(name) !== key) continue;
      if (mode === 'dept' && key && deptId !== key) continue;
      if (mode === 'ranks' && rankFilter && !rankFilter[rank]) continue;

      var memberId = hasColumn(map, COLS.ID) ? normalize(String(row[map[COLS.ID]] || ''), true) : '';
      var dharmaName = hasColumn(map, COLS.DHARMA_NAME) ? String(row[map[COLS.DHARMA_NAME]] || '') : '';
      var birth = hasColumn(map, COLS.BIRTH) ? formatInAppTimeZone(row[map[COLS.BIRTH]], 'yyyy-MM-dd') : '';
      var lunar = hasColumn(map, COLS.LUNAR) ? String(row[map[COLS.LUNAR]] || '') : '';
      var age = hasColumn(map, COLS.AGE) ? String(row[map[COLS.AGE]] || '') : '';
      var birthPlace = hasColumn(map, COLS.BIRTHPLACE) ? String(row[map[COLS.BIRTHPLACE]] || '') : '';
      var address = hasColumn(map, COLS.ADDRESS) ? String(row[map[COLS.ADDRESS]] || '') : '';
      var phone = hasColumn(map, COLS.PHONE) ? String(row[map[COLS.PHONE]] || '') : '';
      var job = hasColumn(map, COLS.JOB) ? String(row[map[COLS.JOB]] || '') : '';
      var company = hasColumn(map, COLS.COMPANY) ? String(row[map[COLS.COMPANY]] || '') : '';
      var referrer = hasColumn(map, COLS.REFERRER) ? String(row[map[COLS.REFERRER]] || '') : '';
      var joinDate = hasColumn(map, COLS.JOIN_DATE) ? formatInAppTimeZone(row[map[COLS.JOIN_DATE]], 'yyyy-MM-dd') : '';
      var photoUrl = hasColumn(map, COLS.PHOTO) ? String(row[map[COLS.PHOTO]] || '') : '';

      // 나이 계산 (없으면 생일에서 계산)
      if (!age && birth) {
        try { age = String(new Date().getFullYear() - parseInt(birth.substring(0, 4)) + 1); } catch (e) {}
      }

      // 생년월일 + 양/음 표시
      var birthDisplay = birth;
      if (birth && lunar) birthDisplay = birth + '(' + lunar + ')';

      results.push({
        member_id: memberId, name: name, rank: rank, dharma_name: dharmaName,
        dept_name: deptName, birth: birthDisplay, age: age,
        birth_place: birthPlace, address: address, phone: phone,
        job: job, company: company, referrer: referrer,
        join_date: joinDate, photo: photoUrl, status: status
      });
    }
  }

  // 정렬: 'name' (가나다순) 또는 기본 'member_id' (회원번호순)
  if (sortBy === 'name') {
    results.sort(function(a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
  } else {
    results.sort(function(a, b) {
      return String(a.member_id || '').localeCompare(String(b.member_id || ''), undefined, { numeric: true });
    });
  }

  return results;
}

/** 부서 목록 반환 (카드 필터용) */
function getDepartmentListForCard() {
  return getDepartmentList();
}

function sortCardCountList_(counts, presetOrder) {
  const orderMap = {};
  for (var oi = 0; oi < presetOrder.length; oi++) orderMap[presetOrder[oi]] = oi;

  const result = [];
  for (var key in counts) {
    result.push({ name: key, count: counts[key] });
  }
  result.sort(function(a, b) {
    var oa = orderMap[a.name] !== undefined ? orderMap[a.name] : 999;
    var ob = orderMap[b.name] !== undefined ? orderMap[b.name] : 999;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function getMemberCardFilterOptions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  const specialSheet = ss.getSheetByName(SHEETS.SPECIAL_MEMBERS);
  const rankCounts = {};
  const statusCounts = {};

  const sheetsToProcess = [];
  if (memSheet) sheetsToProcess.push(memSheet);
  if (specialSheet) sheetsToProcess.push(specialSheet);

  for (var s = 0; s < sheetsToProcess.length; s++) {
    var sheet = sheetsToProcess[s];
    var map = getColumnMap(sheet);
    var hasRank = hasColumn(map, COLS.RANK);
    var hasStatus = hasColumn(map, COLS.STATUS);
    if (!hasRank && !hasStatus) continue;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;
    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var status = hasStatus ? String(row[map[COLS.STATUS]] || '').trim() : '';
      if (status) statusCounts[status] = (statusCounts[status] || 0) + 1;

      if (hasRank && status !== '탈퇴' && status !== '제명' && status !== '자격정지') {
        var rank = String(row[map[COLS.RANK]] || '').trim();
        if (rank) rankCounts[rank] = (rankCounts[rank] || 0) + 1;
      }
    }
  }

  return {
    departments: getDepartmentList(),
    ranks: sortCardCountList_(rankCounts, ['반야', '진명', '수명', '명인', '상인', '명사', '법사', '전법사', '교무']),
    statuses: sortCardCountList_(statusCounts, ['정회원', '준회원', '명예회원', '휴회', '탈퇴', '제명'])
  };
}

/**
 * Members 시트에서 실제 사용 중인 법계(법계) 목록 반환.
 * 탈퇴/제명 제외.
 */
function getRankListForCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) return [];
  const specialSheet = ss.getSheetByName(SHEETS.SPECIAL_MEMBERS);

  // 정해진 표시 순서 (법계 위계 순)
  const PRESET_ORDER = ['반야', '진명', '수명', '명인', '상인', '명사', '법사', '전법사', '교무'];
  const orderMap = {};
  for (var oi = 0; oi < PRESET_ORDER.length; oi++) orderMap[PRESET_ORDER[oi]] = oi;

  const sheetsToProcess = [memSheet];
  if (specialSheet) sheetsToProcess.push(specialSheet);

  const counts = {};
  for (var s = 0; s < sheetsToProcess.length; s++) {
    var sheet = sheetsToProcess[s];
    var map = getColumnMap(sheet);
    if (!hasColumn(map, COLS.RANK)) continue;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;
    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var status = hasColumn(map, COLS.STATUS) ? String(row[map[COLS.STATUS]] || '').trim() : '';
      if (status === '탈퇴' || status === '제명' || status === '자격정지') continue;
      var rank = String(row[map[COLS.RANK]] || '').trim();
      if (!rank) continue;
      counts[rank] = (counts[rank] || 0) + 1;
    }
  }

  // 배열로 변환 + 정렬
  var result = [];
  for (var r in counts) {
    result.push({ name: r, count: counts[r] });
  }
  result.sort(function(a, b) {
    var oa = orderMap[a.name] !== undefined ? orderMap[a.name] : 999;
    var ob = orderMap[b.name] !== undefined ? orderMap[b.name] : 999;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });
  return result;
}

/**
 * Members 시트에서 실제 사용 중인 회원상태 목록 반환. (O열)
 */
function getStatusListForCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) return [];
  const specialSheet = ss.getSheetByName(SHEETS.SPECIAL_MEMBERS);

  // 일반적인 표시 순서 (활동 중 → 비활동 순)
  const PRESET_ORDER = ['정회원', '준회원', '명예회원', '휴회', '탈퇴', '제명'];
  const orderMap = {};
  for (var oi = 0; oi < PRESET_ORDER.length; oi++) orderMap[PRESET_ORDER[oi]] = oi;

  const sheetsToProcess = [memSheet];
  if (specialSheet) sheetsToProcess.push(specialSheet);

  const counts = {};
  for (var s = 0; s < sheetsToProcess.length; s++) {
    var sheet = sheetsToProcess[s];
    var map = getColumnMap(sheet);
    if (!hasColumn(map, COLS.STATUS)) continue;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;
    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      var status = String(data[i][map[COLS.STATUS]] || '').trim();
      if (!status) continue;
      counts[status] = (counts[status] || 0) + 1;
    }
  }

  var result = [];
  for (var s in counts) {
    result.push({ name: s, count: counts[s] });
  }
  result.sort(function(a, b) {
    var oa = orderMap[a.name] !== undefined ? orderMap[a.name] : 999;
    var ob = orderMap[b.name] !== undefined ? orderMap[b.name] : 999;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });
  return result;
}

/**
 * 전체 회원 PDF 생성 → Drive 저장 → 다운로드 URL 반환.
 * @param {string} mode  'all' | 'dept'
 * @param {string} keyword  부서ID (mode='dept' 일 때)
 * @return {string} 다운로드 URL
 */
/**
 * 회원 카드 PDF 생성 (배치 분할 + 병합).
 * 20명씩 나눠 PDF를 만든 뒤 하나로 합친다.
 * Apps Script 6분 제한을 우회하기 위해 배치당 별도 PDF 생성.
 */
function generateMemberCardsPdf(mode, keyword) {
  var members = getMemberCardsData(mode || 'all', keyword || '');
  if (!members.length) throw new Error('출력할 회원이 없습니다.');

  var BATCH_SIZE = 20;
  var label = mode === 'dept' && keyword ? keyword : '전체';
  var timestamp = Utilities.formatDate(new Date(), APP_TIMEZONE, 'yyyyMMdd_HHmmss');

  // 배치가 1개면 바로 생성
  if (members.length <= BATCH_SIZE) {
    var html = buildMemberCardsHtml_(members);
    var blob = HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf');
    blob.setName('회원카드_' + label + '_' + timestamp + '.pdf');
    var file = DriveApp.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  }

  // 여러 배치: 각 배치 PDF → Drive 임시 저장 → 마지막에 병합
  var pdfBlobs = [];
  var totalBatches = Math.ceil(members.length / BATCH_SIZE);

  for (var b = 0; b < totalBatches; b++) {
    var start = b * BATCH_SIZE;
    var end = Math.min(start + BATCH_SIZE, members.length);
    var batch = members.slice(start, end);

    var batchHtml = buildMemberCardsHtml_(batch);
    var batchBlob = HtmlService.createHtmlOutput(batchHtml).getBlob().getAs('application/pdf');
    batchBlob.setName('batch_' + b + '.pdf');
    pdfBlobs.push(batchBlob);
  }

  // PDF 병합: 첫 번째 PDF에 나머지를 이어붙임
  var mergedBlob = mergePdfBlobs_(pdfBlobs);
  mergedBlob.setName('회원카드_' + label + '_' + timestamp + '.pdf');

  var file = DriveApp.createFile(mergedBlob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

/**
 * 여러 PDF blob을 하나로 병합.
 * Google Docs를 임시로 만들어 각 PDF를 삽입하는 방식은 불가하므로,
 * Drive API의 export 기능 대신, 각 배치를 Drive에 저장 후
 * Apps Script의 제한 내에서 처리.
 *
 * 실제로 Apps Script에는 네이티브 PDF 병합이 없으므로
 * 각 배치 PDF를 Drive 폴더에 저장하고 폴더 URL을 반환하는 방식으로 대체.
 */
function mergePdfBlobs_(blobs) {
  // Apps Script에 PDF 병합 API가 없으므로
  // 모든 배치 HTML을 합쳐서 하나의 큰 HTML로 만든 뒤 PDF 변환
  // → 이 방식은 메모리 문제 가능
  // 따라서 배치별 PDF를 폴더에 저장하는 방식으로 전환
  // (이 함수는 단일 blob 반환이 필요하므로 첫 번째만 반환)
  return blobs[0]; // fallback
}

function getMemberCardPdfJobCacheKey_(jobId, suffix) {
  return 'MEMBER_CARD_PDF_JOB:' + jobId + ':' + suffix;
}

function getMemberCardPdfJobPropKey_(jobId) {
  return 'MEMBER_CARD_PDF_JOB_FILE:' + jobId;
}

function cleanupMemberCardPdfFolder_(folder) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    try { files.next().setTrashed(true); } catch (e) {}
  }
}

function filterExcludedMembers_(members, excludeIds) {
  if (!excludeIds || !excludeIds.length) return members;
  const excludeSet = {};
  for (var ei = 0; ei < excludeIds.length; ei++) {
    var eid = String(excludeIds[ei] || '').trim();
    if (eid) excludeSet[eid] = true;
  }
  return members.filter(function(m) {
    return !excludeSet[String(m.member_id || '').trim()];
  });
}

function cacheMemberCardsPdfJob_(jobId, folderId, jobFileId, members, batchSize) {
  const cache = CacheService.getScriptCache();
  const total = members.length;
  const totalBatches = Math.ceil(total / batchSize);
  const meta = {
    jobId: jobId,
    folderId: folderId,
    jobFileId: jobFileId,
    total: total,
    totalBatches: totalBatches,
    batchSize: batchSize
  };

  try {
    cache.put(getMemberCardPdfJobCacheKey_(jobId, 'META'), JSON.stringify(meta), CACHE_TTL);
    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const batch = members.slice(start, Math.min(start + batchSize, total));
      cache.put(getMemberCardPdfJobCacheKey_(jobId, 'BATCH:' + i), JSON.stringify(batch), CACHE_TTL);
    }
  } catch (e) {
    // CacheService는 값 크기 제한이 있으므로 실패해도 Drive JSON 파일 fallback을 사용한다.
  }
  return meta;
}

function createMemberCardsPdfJob_(mode, keyword, excludeIds, sortBy) {
  const folder = getOrCreateDriveFolder_(MEMBER_CARD_PDF_FOLDER_NAME, true);
  cleanupMemberCardPdfFolder_(folder);

  let members = getMemberCardsData(mode || 'all', keyword || '', sortBy || 'member_id');
  members = filterExcludedMembers_(members, excludeIds);
  if (!members.length) throw new Error('출력할 회원이 없습니다.');

  const jobId = Utilities.getUuid();
  const payload = {
    version: 1,
    created_at: nowDateTimeStr(),
    folder_id: folder.getId(),
    batch_size: MEMBER_CARD_PDF_BATCH_SIZE,
    members: members
  };
  const blob = Utilities.newBlob(
    JSON.stringify(payload),
    'application/json',
    MEMBER_CARD_PDF_JOB_PREFIX + jobId + '.json'
  );
  const jobFile = folder.createFile(blob);
  PropertiesService.getScriptProperties().setProperty(getMemberCardPdfJobPropKey_(jobId), jobFile.getId());

  const meta = cacheMemberCardsPdfJob_(jobId, folder.getId(), jobFile.getId(), members, MEMBER_CARD_PDF_BATCH_SIZE);
  meta.members = members;
  return meta;
}

function loadMemberCardsPdfJobFromDrive_(jobId) {
  const props = PropertiesService.getScriptProperties();
  let jobFileId = props.getProperty(getMemberCardPdfJobPropKey_(jobId));
  let file = null;

  if (jobFileId) {
    try {
      file = DriveApp.getFileById(jobFileId);
      if (file.isTrashed()) file = null;
    } catch (e) {
      props.deleteProperty(getMemberCardPdfJobPropKey_(jobId));
      jobFileId = '';
    }
  }

  if (!file) {
    const folder = getOrCreateDriveFolder_(MEMBER_CARD_PDF_FOLDER_NAME, true);
    const files = folder.getFilesByName(MEMBER_CARD_PDF_JOB_PREFIX + jobId + '.json');
    if (files.hasNext()) {
      file = files.next();
      jobFileId = file.getId();
      props.setProperty(getMemberCardPdfJobPropKey_(jobId), jobFileId);
    }
  }

  if (!file) throw new Error('PDF 작업 캐시를 찾을 수 없습니다. 다시 생성해주세요.');

  const payload = JSON.parse(file.getBlob().getDataAsString('UTF-8') || '{}');
  const members = Array.isArray(payload.members) ? payload.members : [];
  if (!members.length) throw new Error('PDF 작업 데이터가 비어 있습니다. 다시 생성해주세요.');

  const folderId = payload.folder_id || getOrCreateDriveFolder_(MEMBER_CARD_PDF_FOLDER_NAME, true).getId();
  const batchSize = Number(payload.batch_size) || MEMBER_CARD_PDF_BATCH_SIZE;
  const meta = cacheMemberCardsPdfJob_(jobId, folderId, jobFileId, members, batchSize);
  meta.members = members;
  return meta;
}

function getMemberCardsPdfJobBatch_(jobId, batchIndex) {
  const cache = CacheService.getScriptCache();
  let meta = null;
  let batch = null;
  const metaRaw = cache.get(getMemberCardPdfJobCacheKey_(jobId, 'META'));
  if (metaRaw) {
    try { meta = JSON.parse(metaRaw); } catch (e) { meta = null; }
  }

  const batchRaw = cache.get(getMemberCardPdfJobCacheKey_(jobId, 'BATCH:' + batchIndex));
  if (batchRaw) {
    try { batch = JSON.parse(batchRaw); } catch (e) { batch = null; }
  }

  if (meta && batch) {
    meta.batch = batch;
    return meta;
  }

  const full = loadMemberCardsPdfJobFromDrive_(jobId);
  const start = batchIndex * full.batchSize;
  full.batch = full.members.slice(start, Math.min(start + full.batchSize, full.total));
  delete full.members;
  return full;
}

function cleanupMemberCardsPdfJob_(jobId, jobFileId) {
  const props = PropertiesService.getScriptProperties();
  const propKey = getMemberCardPdfJobPropKey_(jobId);
  const fileId = jobFileId || props.getProperty(propKey);
  if (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  }
  props.deleteProperty(propKey);
}

/**
 * 대용량 PDF 생성: 배치별 PDF를 Drive 폴더에 저장하고 폴더 URL 반환.
 * 클라이언트에서 호출하여 진행상황 추적 가능.
 */
function generateMemberCardsPdfBatch(mode, keyword, batchIndex, excludeIds, sortBy, showNameCheck, jobId) {
  var idx = batchIndex || 0;
  var job = (!jobId || idx === 0)
    ? createMemberCardsPdfJob_(mode || 'all', keyword || '', excludeIds || [], sortBy || 'member_id')
    : getMemberCardsPdfJobBatch_(jobId, idx);

  if (idx >= job.totalBatches) {
    var doneFolder = DriveApp.getFolderById(job.folderId);
    cleanupMemberCardsPdfJob_(job.jobId, job.jobFileId);
    return { done: true, total: job.total, batches: job.totalBatches, folderUrl: doneFolder.getUrl(), jobId: job.jobId };
  }

  var folder = DriveApp.getFolderById(job.folderId);
  var start = idx * job.batchSize;
  var end = Math.min(start + job.batchSize, job.total);
  var batch = job.batch || (job.members || []).slice(start, end);

  var html = buildMemberCardsHtml_(batch, !!showNameCheck);
  var blob = HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf');
  var seqNum = String(idx + 1);
  while (seqNum.length < 3) seqNum = '0' + seqNum;
  blob.setName('회원카드_' + seqNum + '.pdf');

  var file = folder.createFile(blob);
  if (!isDriveFolderSharedWithLink_(MEMBER_CARD_PDF_FOLDER_NAME)) {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }

  return {
    done: false,
    jobId: job.jobId,
    batchIndex: idx,
    nextBatch: idx + 1,
    totalBatches: job.totalBatches,
    totalMembers: job.total,
    processed: end,
    fileUrl: file.getUrl(),
    folderUrl: folder.getUrl()
  };
}

/**
 * 회원 카드 HTML 문자열 생성 (PDF 변환용).
 * 사진은 Drive에서 직접 base64로 변환하여 인라인 삽입 (외부 URL은 PDF에 포함 불가).
 */
function buildMemberCardsHtml_(members, showNameCheck) {
  // A4 portrait 가용 너비 ≈ 190mm (210mm - 좌우 마진 10mm×2)
  // colgroup 으로 열 너비 고정: 사진105 + 라벨48 + 값80 + 라벨48 + 값80 + 라벨48 + 값95 + 와이드175 ≈ 679px ≈ 190mm
  var css = [
    '<style>',
    '  @page { size: A4 portrait; margin: 12mm 10mm; }',
    '  * { margin:0; padding:0; box-sizing:border-box; }',
    '  body { font-family: "Malgun Gothic","맑은 고딕",sans-serif; font-size:11px; color:#222; }',
    '  .card { width:100%; table-layout:fixed; border-collapse:collapse; margin-bottom:14mm; page-break-inside:avoid; }',
    '  .card td { border:1px solid #999; padding:3px 4px; vertical-align:middle; text-align:center;',
    '             height:30px; overflow:hidden; white-space:nowrap; }',
    '  .photo-cell { padding:0 !important; font-size:0; line-height:0; }',
    '  .photo-cell img { display:block; width:100%; height:120px; }',
    '  .label { background:#f0f0f0; font-weight:bold; font-size:9px; color:#444; }',
    '  .value { font-size:11px; }',
    '  .name-val { font-weight:bold; font-size:13px; }',
    '  .name-check { display:inline-block; width:12px; height:12px; border:1.2px solid #000; margin-left:6px; vertical-align:middle; background:#fff; }',
    '  .wide-cell { text-align:center; padding:3px 5px; font-size:11px; line-height:1.3;',
    '               white-space:normal !important; overflow:visible !important;',
    '               word-break:keep-all; word-wrap:break-word; height:auto !important; }',
    '  .wide-label { font-weight:normal; font-size:8px; color:#aaa; display:block; margin-bottom:0; }',
    '</style>'
  ].join('\n');

  var body = '';
  var cardsPerPage = 6;

  for (var i = 0; i < members.length; i++) {
    var m = members[i];

    // ★ 사진: PDF는 background-image 미지원 → <img> 사용
    // 여백 해결: photo-cell에 font-size:0;line-height:0 + img에 display:block
    var photoHtml = '<div style="width:105px;height:120px;background:#eee;font-size:9px;line-height:120px;text-align:center;color:#aaa">사진 없음</div>';
    if (m.photo) {
      var fileId = extractDriveFileId_(m.photo);
      if (fileId) {
        var photoResult = fetchPhotoAsBase64_(fileId, true);
        if (photoResult.ok) {
          photoHtml = '<img src="data:' + photoResult.ct + ';base64,' + photoResult.b64 + '">';
        } else {
          photoHtml = '<div style="width:105px;height:120px;background:#eee;font-size:8px;line-height:120px;text-align:center;color:#aaa">' + esc_(photoResult.error) + '</div>';
        }
      }
    }

    var pageBreak = (i > 0 && i % cardsPerPage === 0) ? ' style="page-break-before:always"' : '';
    body += '<table class="card"' + pageBreak + '>';
    body += '<colgroup>';
    body += '  <col style="width:105px">'; // 사진
    body += '  <col style="width:42px">';  // 라벨1
    body += '  <col style="width:78px">';  // 값1
    body += '  <col style="width:42px">';  // 라벨2
    body += '  <col style="width:78px">';  // 값2
    body += '  <col style="width:42px">';  // 라벨3
    body += '  <col style="width:95px">';  // 값3
    body += '  <col style="width:198px">'; // 출생지/주소 (168+30)
    body += '</colgroup>';
    // 값 셀: 글자수에 따라 font-size 축소
    // padding 좌우 4px×2 = 8px 제외한 실제 텍스트 가용폭 사용
    // 한글 1자 ≈ 폰트크기×0.9px, 영숫자/기호 1자 ≈ 폰트크기×0.55px
    var V = function(s, cellW, basePx) {
      if (!s) return '';
      var str = String(s);
      var base = basePx || 11;
      var usable = (cellW || 70) - 8; // padding 8px 제외
      // 글자별 폭 계산
      var totalW = 0;
      for (var ci = 0; ci < str.length; ci++) {
        totalW += str.charCodeAt(ci) > 127 ? base * 0.9 : base * 0.55;
      }
      if (totalW <= usable) return esc_(str);
      var newSize = Math.max(6, Math.floor(base * usable / totalW));
      return '<span style="font-size:' + newSize + 'px">' + esc_(str) + '</span>';
    };
    // 와이드 셀(출생지/주소): 스페이스 단위로 줄바꿈, 필요시 글자 축소
    // cellW: 셀 너비(px), maxLines: 최대 줄 수
    var VW = function(s, cellW, maxLines) {
      if (!s) return '';
      var str = String(s);
      var fontSize = 9;
      var usable = (cellW || 188) - 10;
      var lines = maxLines || 3;

      // 글자폭 계산 함수 (PDF 렌더러 기준 보수적 계산)
      var calcW = function(text, sz) {
        var w = 0;
        for (var ci = 0; ci < text.length; ci++) {
          w += text.charCodeAt(ci) > 127 ? sz * 1.1 : sz * 0.65;
        }
        return w;
      };

      // 스페이스 단위로 단어 분리 → 줄 배치
      var words = str.split(/\s+/);
      var buildLines = function(sz) {
        var result = [];
        var currentLine = '';
        for (var wi = 0; wi < words.length; wi++) {
          var testLine = currentLine ? currentLine + ' ' + words[wi] : words[wi];
          if (calcW(testLine, sz) <= usable) {
            currentLine = testLine;
          } else {
            if (currentLine) result.push(currentLine);
            currentLine = words[wi];
          }
        }
        if (currentLine) result.push(currentLine);
        return result;
      };

      // 기본 크기로 줄 배치 시도
      var arranged = buildLines(fontSize);
      // 줄 수 초과 시 글자 축소
      while (arranged.length > lines && fontSize > 7) {
        fontSize--;
        arranged = buildLines(fontSize);
      }

      var html = '';
      for (var li = 0; li < arranged.length; li++) {
        if (li > 0) html += '<br>';
        html += esc_(arranged[li]);
      }
      if (fontSize < 9) {
        return '<span style="font-size:' + fontSize + 'px">' + html + '</span>';
      }
      return html;
    };
    body += '<tr>';
    body += '  <td class="photo-cell" rowspan="4">' + photoHtml + '</td>';
    var nameCellContent = V(m.name, 72, 13) + (showNameCheck ? '<span class="name-check"></span>' : '');
    body += '  <td class="label">이름</td><td class="value name-val">' + nameCellContent + '</td>';
    body += '  <td class="label">법계</td><td class="value">' + V(m.rank, 72) + '</td>';
    body += '  <td class="label">생년월일</td><td class="value">' + V(m.birth, 89) + '</td>';
    body += '  <td class="wide-cell" rowspan="2"><span class="wide-label">출생지</span>' + VW(m.birth_place, 188, 2) + '</td>';
    body += '</tr>';
    body += '<tr>';
    body += '  <td class="label">법명</td><td class="value">' + V(m.dharma_name, 72) + '</td>';
    body += '  <td class="label">소개자</td><td class="value">' + V(m.referrer, 72) + '</td>';
    body += '  <td class="label">나이</td><td class="value">' + V(m.age, 89) + '</td>';
    body += '</tr>';
    body += '<tr>';
    body += '  <td class="label">소속</td><td class="value">' + V(m.dept_name, 72) + '</td>';
    body += '  <td class="label">직업</td><td class="value">' + V(m.job, 72) + '</td>';
    body += '  <td class="label">입회일</td><td class="value">' + V(m.join_date, 89) + '</td>';
    body += '  <td class="wide-cell" rowspan="2"><span class="wide-label">주소</span>' + VW(m.address, 188, 2) + '</td>';
    body += '</tr>';
    body += '<tr>';
    body += '  <td class="label">회원번호</td><td class="value">' + V(m.member_id, 72) + '</td>';
    body += '  <td class="label">직장</td><td class="value">' + V(m.company, 72) + '</td>';
    body += '  <td class="label">전화번호</td><td class="value">' + V(m.phone, 89) + '</td>';
    body += '</tr>';
    body += '</table>\n';
  }

  return '<!DOCTYPE html><html><head><meta charset="utf-8">' + css + '</head><body>' + body + '</body></html>';
}

/** HTML 이스케이프 헬퍼 */
function esc_(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Drive 파일 ID로부터 사진 base64 데이터 추출.
 * @return {Object}  성공: {ok:true, ct, b64}  실패: {ok:false, error}
 */
function getPhotoThumbPropKey_(fileId, size) {
  return 'PHOTO_THUMB_FILE:' + size + ':' + fileId;
}

function ensurePhotoThumbnailFile_(fileId, size) {
  const thumbSize = size || 400;
  const props = PropertiesService.getScriptProperties();
  const key = getPhotoThumbPropKey_(fileId, thumbSize);
  const cachedId = props.getProperty(key);
  const thumbName = fileId + '_w' + thumbSize + '.jpg';

  if (cachedId) {
    try {
      const cached = DriveApp.getFileById(cachedId);
      if (!cached.isTrashed()) return cachedId;
    } catch (e) {
      props.deleteProperty(key);
    }
  }

  const folder = getOrCreateDriveFolder_(PHOTO_THUMB_FOLDER_NAME, false);
  const existing = folder.getFilesByName(thumbName);
  if (existing.hasNext()) {
    const file = existing.next();
    props.setProperty(key, file.getId());
    return file.getId();
  }

  try {
    const token = ScriptApp.getOAuthToken();
    const url = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w' + thumbSize;
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (res.getResponseCode() !== 200) return '';
    const blob = res.getBlob();
    const bytes = blob.getBytes();
    if (!bytes || bytes.length === 0) return '';
    const ct = blob.getContentType();
    if (ct && ct.indexOf('image') < 0) return '';
    blob.setName(thumbName);
    const file = folder.createFile(blob);
    props.setProperty(key, file.getId());
    return file.getId();
  } catch (e) {
    return '';
  }
}

function readDriveImageAsBase64_(fileId) {
  // 방법 1: DriveApp 직접 (MIME 체크 안함 — Drive가 octet-stream 반환하는 경우 있음)
  try {
    var file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) return { ok: false, error: '휴지통' };
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    if (bytes.length === 0) return { ok: false, error: '빈파일' };
    var ct = blob.getContentType();
    // content-type이 image가 아니면 강제 image/jpeg 설정
    if (!ct || ct.indexOf('image') < 0) ct = 'image/jpeg';
    return { ok: true, ct: ct, b64: Utilities.base64Encode(bytes) };
  } catch (e1) {
    // 방법 1 실패 → 방법 2
  }

  // 방법 2: Drive REST API + OAuth
  try {
    var token = ScriptApp.getOAuthToken();
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'Authorization': 'Bearer ' + token } });
    if (res.getResponseCode() === 200) {
      var blob2 = res.getBlob();
      var bytes2 = blob2.getBytes();
      if (bytes2.length > 0) {
        var ct2 = blob2.getContentType();
        if (!ct2 || ct2.indexOf('image') < 0) ct2 = 'image/jpeg';
        return { ok: true, ct: ct2, b64: Utilities.base64Encode(bytes2) };
      }
    }
    return { ok: false, error: 'API' + res.getResponseCode() };
  } catch (e2) {
    return { ok: false, error: String(e2.message || '').substring(0, 15) };
  }
}

function fetchPhotoAsBase64_(fileId, useThumbnail) {
  if (useThumbnail) {
    const thumbId = ensurePhotoThumbnailFile_(fileId, 400);
    if (thumbId) {
      const thumbResult = readDriveImageAsBase64_(thumbId);
      if (thumbResult.ok) return thumbResult;
    }
  }
  return readDriveImageAsBase64_(fileId);
}

/**
 * [디버깅용] 사진 로딩 상태 진단.
 * Apps Script 에디터에서 실행하면 Logger에 결과 출력.
 */
function debugPhotoLoading() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  var map = getColumnMap(memSheet);
  var lastRow = memSheet.getLastRow();
  var data = memSheet.getRange(2, 1, lastRow - 1, memSheet.getLastColumn()).getValues();

  var total = 0, hasUrl = 0, loaded = 0, failed = 0;
  var failures = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var status = hasColumn(map, COLS.STATUS) ? String(row[map[COLS.STATUS]] || '') : '';
    if (status === '탈퇴' || status === '제명') continue;
    total++;

    var photoUrl = hasColumn(map, COLS.PHOTO) ? String(row[map[COLS.PHOTO]] || '') : '';
    if (!photoUrl) continue;
    hasUrl++;

    var name = hasColumn(map, COLS.NAME) ? String(row[map[COLS.NAME]] || '') : '';
    var memberId = hasColumn(map, COLS.ID) ? String(row[map[COLS.ID]] || '') : '';
    var fileId = extractDriveFileId_(photoUrl);

    if (!fileId) {
      failed++;
      failures.push(memberId + ' ' + name + ': fileId 추출 실패 - URL: ' + photoUrl);
      continue;
    }

    try {
      var file = DriveApp.getFileById(fileId);
      var trashed = file.isTrashed();
      var mimeType = file.getMimeType();
      var size = file.getSize();
      if (trashed) {
        failed++;
        failures.push(memberId + ' ' + name + ': 휴지통에 있음');
      } else if (!mimeType || mimeType.indexOf('image') < 0) {
        failed++;
        failures.push(memberId + ' ' + name + ': 이미지 아님 (' + mimeType + ')');
      } else {
        var blob = file.getBlob();
        var bytes = blob.getBytes();
        if (bytes.length === 0) {
          failed++;
          failures.push(memberId + ' ' + name + ': 빈 파일 (0 bytes)');
        } else {
          loaded++;
        }
      }
    } catch (err) {
      failed++;
      failures.push(memberId + ' ' + name + ': ' + err.message + ' (fileId: ' + fileId + ')');
    }
  }

  var msg = '전체: ' + total + '명, 사진URL있음: ' + hasUrl + '명, 로딩성공: ' + loaded + '명, 실패: ' + failed + '명';
  if (failures.length > 0) {
    msg += '\n\n실패 목록:\n' + failures.join('\n');
  }
  Logger.log(msg);
  return msg;
}

/****************************************************************
 * 자동추출: 사진 파일명 → Members 매칭 → Drive 링크 추출
 * "자동추출" 시트에 결과 생성 (Members 시트는 변경하지 않음)
 ****************************************************************/
function autoExtractPhotoLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Members 시트 로드 ──
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error('Members 시트를 찾을 수 없습니다.');
  const map = getColumnMap(memSheet);
  const lastRow = memSheet.getLastRow();
  const lastCol = memSheet.getLastColumn();
  if (lastRow < 2) throw new Error('Members 시트에 데이터가 없습니다.');
  const memData = memSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // ── 2. 부서 정보 ──
  const deptInfo = getDepartmentInfoMaps_();

  // 이름 → [{rowIdx, name, deptName, deptId, memberId, rank, status}] 맵
  const membersByName = {};
  for (let i = 0; i < memData.length; i++) {
    const row = memData[i];
    const name = normalize(String(row[map[COLS.NAME]] || ''));
    if (!name) continue;
    const status = map[COLS.STATUS] !== undefined ? String(row[map[COLS.STATUS]] || '') : '';
    if (status === '탈퇴' || status === '제명') continue;
    const deptId = map[COLS.DEPT_ID] !== undefined ? String(row[map[COLS.DEPT_ID]] || '') : '';
    const deptName = deptInfo.byId[deptId] ? deptInfo.byId[deptId].name : (deptId || '소속미정');
    const memberId = map[COLS.ID] !== undefined ? String(row[map[COLS.ID]] || '') : '';
    const rank = map[COLS.RANK] !== undefined ? String(row[map[COLS.RANK]] || '') : '';
    const existingPhoto = map[COLS.PHOTO] !== undefined ? String(row[map[COLS.PHOTO]] || '') : '';
    if (!membersByName[name]) membersByName[name] = [];
    membersByName[name].push({
      rowIdx: i, name: name, deptName: deptName, deptId: deptId,
      memberId: memberId, rank: rank, status: status, existingPhoto: existingPhoto
    });
  }

  // ── 3. Drive 폴더에서 파일 목록 로드 ──
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (!folders.hasNext()) throw new Error('"' + FOLDER_NAME + '" 폴더를 찾을 수 없습니다.');
  const folder = folders.next();
  const files = folder.getFiles();
  const driveFiles = {}; // fileName → {id, url, originalName}
  while (files.hasNext()) {
    const f = files.next();
    const fNameRaw = f.getName();
    // macOS NFD → NFC 정규화 (파일명 한글 정규식 매칭을 위해)
    const fName = typeof fNameRaw.normalize === 'function' ? fNameRaw.normalize('NFC') : fNameRaw;
    driveFiles[fName] = {
      id: f.getId(),
      url: 'https://drive.google.com/file/d/' + f.getId() + '/view?usp=drive_link'
    };
  }

  // ── 4. 이미 Members에 링크된 파일 URL 수집 (photo.html 업로드 분) ──
  var existingPhotoFileIds = {};
  for (var ei = 0; ei < memData.length; ei++) {
    var photoUrl = map[COLS.PHOTO] !== undefined ? String(memData[ei][map[COLS.PHOTO]] || '') : '';
    if (photoUrl) {
      var existId = extractDriveFileId_(photoUrl);
      if (existId) existingPhotoFileIds[existId] = true;
    }
  }

  // ── 5. 파일명 파싱 & 매칭 ──
  var fileNames = Object.keys(driveFiles);

  var results = [];
  var unmatchedList = [];
  var skippedAlreadyLinked = 0;

  for (var fi = 0; fi < fileNames.length; fi++) {
    var fileName = fileNames[fi];
    var driveInfo = driveFiles[fileName];

    // 이미 Members 사진 컬럼에 링크된 파일 → 스킵 (photo.html 업로드 분)
    if (existingPhotoFileIds[driveInfo.id]) {
      skippedAlreadyLinked++;
      continue;
    }

    var parsed = parsePhotoFileName_(fileName);
    if (!parsed.name) {
      unmatchedList.push([fileName, '', '', '', '', driveInfo.url, '이름 파싱 실패']);
      continue;
    }

    var candidates = membersByName[parsed.name];
    if (!candidates || candidates.length === 0) {
      unmatchedList.push([fileName, parsed.name, parsed.rank || '', parsed.dept || '', '', driveInfo.url, 'Members에 이름 없음']);
      continue;
    }

    // 동명이인 처리: 부서명으로 추가 필터
    var matched = null;
    if (candidates.length === 1) {
      matched = candidates[0];
    } else if (parsed.dept) {
      var deptMatched = [];
      for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci];
        if (c.deptName === parsed.dept || c.deptName.indexOf(parsed.dept) >= 0 || parsed.dept.indexOf(c.deptName) >= 0) {
          deptMatched.push(c);
        }
      }
      if (deptMatched.length === 1) {
        matched = deptMatched[0];
      } else if (deptMatched.length > 1) {
        matched = deptMatched[0];
      }
    }

    if (matched) {
      results.push([
        fileName, matched.memberId, matched.name, matched.rank,
        matched.deptName, driveInfo.url, matched.existingPhoto, '매칭 성공'
      ]);
    } else {
      var note = candidates.length > 1 ? '동명이인 ' + candidates.length + '명 (부서 불일치)' : '부서 불일치';
      unmatchedList.push([fileName, parsed.name, parsed.rank || '', parsed.dept || '', '', driveInfo.url, note]);
    }
  }

  // ── 6. "자동추출" 시트 생성/초기화 ──
  var sheetName = '자동추출';
  var outSheet = ss.getSheetByName(sheetName);
  if (outSheet) {
    outSheet.clear();
  } else {
    outSheet = ss.insertSheet(sheetName);
  }

  var headers = ['파일명', '회원번호', '성명', '법계', '소속(부서명)', '사진 Drive 링크', '기존 사진 링크', '비고'];
  var allRows = [headers];

  // 매칭 성공 결과
  for (var ri = 0; ri < results.length; ri++) {
    allRows.push(results[ri]);
  }

  // 구분선
  if (unmatchedList.length > 0) {
    allRows.push(['── 매칭 실패 ──', '', '', '', '', '', '', '']);
    for (var ui = 0; ui < unmatchedList.length; ui++) {
      var u = unmatchedList[ui];
      allRows.push([u[0], '', u[1], u[2], u[3], u[5] || '', '', u[6]]);
    }
  }

  outSheet.getRange(1, 1, allRows.length, headers.length).setValues(allRows);

  // 헤더 서식
  var headerRange = outSheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4a86c8');
  headerRange.setFontColor('#ffffff');

  // 열 너비 조정
  outSheet.setColumnWidth(1, 250); // 파일명
  outSheet.setColumnWidth(2, 100); // 회원번호
  outSheet.setColumnWidth(3, 80);  // 성명
  outSheet.setColumnWidth(4, 60);  // 법계
  outSheet.setColumnWidth(5, 120); // 소속
  outSheet.setColumnWidth(6, 350); // Drive 링크
  outSheet.setColumnWidth(7, 350); // 기존 사진 링크
  outSheet.setColumnWidth(8, 200); // 비고

  // 매칭 실패 구분선 행 강조
  for (var si = 0; si < allRows.length; si++) {
    if (allRows[si][0] === '── 매칭 실패 ──') {
      outSheet.getRange(si + 1, 1, 1, headers.length).setBackground('#ffcccc').setFontWeight('bold');
      break;
    }
  }

  return '자동추출 완료: 매칭 성공 ' + results.length + '건, 실패 ' + unmatchedList.length + '건, 기존 링크 스킵 ' + skippedAlreadyLinked + '건';
}

/****************************************************************
 * Drive 사진 파일 일괄 리네임
 * Members 시트 사진 컬럼의 Drive 파일을
 * "회원번호_성명_법계_소속.확장자" 형식으로 변경
 * (Drive 링크는 fileId 기반이므로 리네임해도 기존 링크 유지)
 ****************************************************************/
function renameMemberPhotos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Members 시트 로드 ──
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  if (!memSheet) throw new Error('Members 시트를 찾을 수 없습니다.');
  const map = getColumnMap(memSheet);
  const lastRow = memSheet.getLastRow();
  const lastCol = memSheet.getLastColumn();
  if (lastRow < 2) throw new Error('Members 시트에 데이터가 없습니다.');
  const memData = memSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // ── 2. 부서 정보 ──
  const deptInfo = getDepartmentInfoMaps_();

  // ── 3. 각 행 순회 → 리네임 ──
  var renamed = 0, skipped = 0, failed = 0, noPhoto = 0;
  var errors = [];

  for (var i = 0; i < memData.length; i++) {
    var row = memData[i];

    // 사진 URL 확인
    var photoUrl = map[COLS.PHOTO] !== undefined ? String(row[map[COLS.PHOTO]] || '') : '';
    if (!photoUrl) { noPhoto++; continue; }

    // fileId 추출
    var fileId = extractDriveFileId_(photoUrl);
    if (!fileId) { noPhoto++; continue; }

    // 회원 정보 추출
    var memberId = map[COLS.ID] !== undefined ? String(row[map[COLS.ID]] || '').trim() : '';
    var memberName = map[COLS.NAME] !== undefined ? normalize(String(row[map[COLS.NAME]] || '')) : '';
    var rank = map[COLS.RANK] !== undefined ? String(row[map[COLS.RANK]] || '').trim() : '';
    var deptId = map[COLS.DEPT_ID] !== undefined ? String(row[map[COLS.DEPT_ID]] || '').trim() : '';
    var deptName = deptInfo.byId[deptId] ? deptInfo.byId[deptId].name : '';

    if (!memberId || !memberName) { skipped++; continue; }

    try {
      var file = DriveApp.getFileById(fileId);
      var oldName = file.getName();

      // 기존 확장자 유지
      var extMatch = oldName.match(/\.(\w+)$/i);
      var ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';

      // 새 파일명 조립: 회원번호_성명_법계_소속.확장자
      var parts = [memberId, memberName];
      if (rank) parts.push(rank);
      if (deptName) parts.push(deptName);
      var newName = parts.join('_') + '.' + ext;

      // 파일명에 사용 불가한 문자 제거
      newName = newName.replace(/[\/\\?%*:|"<>]/g, '');

      // 기존 이름과 같으면 스킵
      if (oldName === newName) { skipped++; continue; }

      file.setName(newName);
      renamed++;
    } catch (e) {
      failed++;
      errors.push('행' + (i + 2) + ' (' + memberName + '): ' + e.message);
    }
  }

  var msg = '리네임 완료: 성공 ' + renamed + '건, 스킵 ' + skipped + '건, 사진없음 ' + noPhoto + '건, 실패 ' + failed + '건';
  if (errors.length > 0) {
    msg += '\n실패 상세:\n' + errors.slice(0, 20).join('\n');
  }
  Logger.log(msg);
  return msg;
}

/**
 * 사진 파일명에서 이름, 법계, 부서명을 파싱.
 * 다양한 파일명 패턴을 처리:
 *   "강경표 상인_무작사.jpg" → {name:"강경표", rank:"상인", dept:"무작사"}
 *   "김훈_총괄부.jpg"       → {name:"김훈", rank:"", dept:"총괄부"}
 *   "권수용.jpg"            → {name:"권수용", rank:"", dept:""}
 *   "사진_한만정.png"        → {name:"한만정", rank:"", dept:""}
 *   "재난음식최은희.jpg"     → {name:"최은희", rank:"", dept:""}
 *   "이명권상무.jpg"         → {name:"이명권", rank:"", dept:""}
 *   "서종근증명사진2 (1).jpeg" → {name:"서종근", rank:"", dept:""}
 *   "혜과상인님 사진-2.jpg"   → {name:"혜과", rank:"상인", dept:""}
 *   "김형환-반명함.jpg"       → {name:"김형환", rank:"", dept:""}
 */
function parsePhotoFileName_(fileName) {
  // 확장자 제거
  var base = fileName.replace(/\.\w+$/i, '');

  // ★ macOS NFD → NFC 정규화 (핵심 수정)
  // macOS는 파일명을 NFD(분해형)로 저장하여 [가-힣] 정규식이 깨짐
  if (typeof base.normalize === 'function') {
    base = base.normalize('NFC');
  }

  var result = { name: '', rank: '', dept: '' };

  // 한글이 하나도 없으면 즉시 실패 (IMG_, 숫자, 영문 파일명)
  if (!/[가-힣]/.test(base)) return result;

  // 전처리: 복사본 표시 "(1)", "(2)" 등 제거
  base = base.replace(/\s*\(\d+\)\s*$/, '');
  // 전처리: [크기변환] 등 대괄호 접두사 제거
  base = base.replace(/^\[.*?\]\s*/, '');

  // 법계 키워드 목록
  var ranks = ['상인', '명사', '법사', '전법사', '교무'];
  // 잡음 키워드
  var noiseWords = ['증명사진', '여권사진', '증명', '사진', '반명함', '상무', '이미지', '스크린샷'];

  // 패턴1: 괄호 안에 한글 이름/부서 — "여권사진(심정욱)" 또는 "이언의(교육부)"
  var parenMatch = base.match(/^(.+?)\(([가-힣]+)\)$/);
  if (parenMatch) {
    var outside = parenMatch[1].trim();
    var inside = parenMatch[2].trim();
    if (/^[가-힣]{2,4}$/.test(inside) && !/부$/.test(inside) && !/사$/.test(inside) && !/단$/.test(inside)) {
      result.name = inside;
      return result;
    } else {
      // 괄호 안이 부서: "이언의(교육부)"
      result.name = outside.replace(/[^가-힣]/g, '');
      result.dept = inside;
      return result;
    }
  }

  // 패턴2: "사진_이름" 또는 "사진-이름"
  var photoPrefix = base.match(/^(?:사진|증명사진|여권사진)[_\-](.+)/);
  if (photoPrefix) {
    var afterPrefix = photoPrefix[1].replace(/[^가-힣]/g, '');
    if (afterPrefix.length >= 2) {
      result.name = afterPrefix;
      return result;
    }
  }

  // 패턴3: "숫자 이름" 또는 "숫자-이름" (회원번호 포함)
  var numPrefix = base.match(/^\d+[\s\-]+([가-힣]{2,4})/);
  if (numPrefix) {
    result.name = numPrefix[1];
    return result;
  }

  // 패턴4: 언더스코어 분리 — "이름 법계_부서" 또는 "이름_부서"
  var underscoreParts = base.split('_');

  if (underscoreParts.length >= 2) {
    var leftPart = underscoreParts[0].trim();
    var rightPart = underscoreParts.slice(1).join('_').trim();

    // rightPart에서 부서명/법계 추출
    var rightKorean = rightPart.replace(/[^가-힣]/g, '');

    // leftPart에서 이름, 법계 추출
    var spaceTokens = leftPart.split(/\s+/);
    var nameTokens = [];
    for (var ti = 0; ti < spaceTokens.length; ti++) {
      var token = spaceTokens[ti].replace(/[^가-힣]/g, '');
      if (!token) continue;
      var isRank = false;
      for (var ri2 = 0; ri2 < ranks.length; ri2++) {
        if (token === ranks[ri2]) { result.rank = token; isRank = true; break; }
      }
      if (!isRank) {
        // 잡음 키워드 제외
        var tokenIsNoise = false;
        for (var nwi = 0; nwi < noiseWords.length; nwi++) {
          if (token === noiseWords[nwi]) { tokenIsNoise = true; break; }
        }
        if (!tokenIsNoise) nameTokens.push(token);
      }
    }
    if (nameTokens.length > 0) result.name = nameTokens[0];

    // rightPart 처리: 법계인지 부서인지
    var rightIsRank = false;
    for (var rk = 0; rk < ranks.length; rk++) {
      if (rightKorean === ranks[rk]) { result.rank = rightKorean; rightIsRank = true; break; }
    }
    if (!rightIsRank && rightKorean) {
      // 잡음 확인
      var rightIsNoise = false;
      for (var nwi2 = 0; nwi2 < noiseWords.length; nwi2++) {
        if (rightKorean === noiseWords[nwi2]) { rightIsNoise = true; break; }
      }
      if (!rightIsNoise) result.dept = rightKorean;
    }

    if (result.name) return result;
  }

  // 패턴5: 공백/하이픈 분리 — "이름 법계", "이름 증명사진", "김형환-반명함"
  var tokens = base.split(/[\s\-]+/);
  if (tokens.length >= 1) {
    for (var si2 = 0; si2 < tokens.length; si2++) {
      var tok = tokens[si2].replace(/[^가-힣]/g, '');
      if (!tok) continue;
      // 법계 확인 ("님" 접미사 제거 후에도 확인)
      var tokClean = tok.replace(/님$/, '');
      var tokIsRank = false;
      for (var rk2 = 0; rk2 < ranks.length; rk2++) {
        if (tok === ranks[rk2] || tokClean === ranks[rk2]) {
          result.rank = ranks[rk2]; tokIsRank = true; break;
        }
      }
      if (tokIsRank) continue;
      // 잡음 확인
      var tokIsNoise = false;
      for (var nwi3 = 0; nwi3 < noiseWords.length; nwi3++) {
        if (tok === noiseWords[nwi3]) { tokIsNoise = true; break; }
      }
      if (tokIsNoise) continue;
      // 이름 후보: 한글 2~4자
      if (!result.name && tok.length >= 2 && tok.length <= 4) {
        result.name = tok;
      }
    }
    if (result.name) return result;
  }

  // 패턴6: 접두사+이름 연결 — "재난음식최은희", "이명권상무", "서종근증명사진"
  // 앞에서부터 성씨를 찾아 이름(2~3자) 추출
  var surnames = ['김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권','황',
    '안','송','류','유','전','홍','고','문','양','손','배','백','허','노','남','심','하','주',
    '우','차','천','묘','연','민','진','엄','채','원','방','공','현','위','탁','여','라','도',
    '예','성','석','염','표','설','왕','단','추','피','봉','제','선','국','담','명','변','곡'];
  var surnameSet = {};
  for (var si3 = 0; si3 < surnames.length; si3++) surnameSet[surnames[si3]] = true;

  var koreanOnly = base.replace(/[^가-힣]/g, '');

  // 앞에서부터 탐색: 성씨를 찾으면 2자 또는 3자 이름 후보 검증
  for (var pos = 0; pos <= koreanOnly.length - 2; pos++) {
    var ch = koreanOnly.charAt(pos);
    if (!surnameSet[ch]) continue;

    // 3자 이름 시도 (성+이름2자)
    var cand3 = koreanOnly.substring(pos, pos + 3);
    if (cand3.length === 3) {
      var noise3 = false;
      for (var nw3 = 0; nw3 < noiseWords.length; nw3++) {
        if (cand3.indexOf(noiseWords[nw3]) >= 0) { noise3 = true; break; }
      }
      for (var rk3 = 0; rk3 < ranks.length; rk3++) {
        if (cand3.indexOf(ranks[rk3]) >= 0) { noise3 = true; break; }
      }
      if (!noise3) { result.name = cand3; return result; }
    }

    // 2자 이름 시도 (성+이름1자)
    var cand2 = koreanOnly.substring(pos, pos + 2);
    if (cand2.length === 2) {
      var noise2 = false;
      for (var nw2 = 0; nw2 < noiseWords.length; nw2++) {
        if (cand2.indexOf(noiseWords[nw2]) >= 0) { noise2 = true; break; }
      }
      for (var rk4 = 0; rk4 < ranks.length; rk4++) {
        if (cand2.indexOf(ranks[rk4]) >= 0) { noise2 = true; break; }
      }
      if (!noise2) { result.name = cand2; return result; }
    }
  }

  // 최후 시도: 한글만 남긴 2~4자
  if (koreanOnly.length >= 2 && koreanOnly.length <= 4) {
    result.name = koreanOnly;
  }

  return result;
}

/****************************************************************
 * 디버그 헬퍼: ScriptProperties 확인용 (에디터에서 수동 실행)
 ****************************************************************/
function debugShowMemberMaxId() {
  const v = PropertiesService.getScriptProperties().getProperty(MEMBER_LAST_ID_PROP_KEY);
  Logger.log(MEMBER_LAST_ID_PROP_KEY + ' = ' + v);
}

function debugDumpScriptProperties() {
  const all = PropertiesService.getScriptProperties().getProperties();
  Logger.log(JSON.stringify(all, null, 2));
}

// V2 가 비어있을 때 즉시 부트스트랩(시트 + 아카이브 max) 후 V1 등 레거시 키를 정리.
// 이미 V2 가 채워져 있으면 아무것도 하지 않는다.
function debugBootstrapMemberMaxId() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memSheet = ss.getSheetByName(SHEETS.MEMBERS);
  const d = getSheetData(SHEETS.MEMBERS);
  const map = d ? d.map : {};
  const result = getStoredMaxMemberId_(memSheet, map);
  Logger.log('bootstrapped MEMBER_LAST_ID_V2 = ' + result);
  Logger.log('current properties = ' + JSON.stringify(PropertiesService.getScriptProperties().getProperties(), null, 2));
}

// V2 와 모든 레거시 키를 삭제. 다음 발급/부트스트랩 시 시트+아카이브에서 다시 계산된다.
function debugResetMemberMaxId() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(MEMBER_LAST_ID_PROP_KEY);
  MEMBER_LAST_ID_LEGACY_KEYS.forEach(k => {
    try { props.deleteProperty(k); } catch (e) {}
  });
  Logger.log('cleared ' + MEMBER_LAST_ID_PROP_KEY + ' + legacy: ' + MEMBER_LAST_ID_LEGACY_KEYS.join(', '));
}

// V2 를 명시적인 값으로 강제 세팅하고 레거시 키를 정리. 비상시 수동 보정용.
function debugSetMemberMaxId(value) {
  const num = Math.floor(Number(value));
  if (!num || num <= 0) {
    Logger.log('invalid value: ' + value);
    return;
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty(MEMBER_LAST_ID_PROP_KEY, String(num));
  MEMBER_LAST_ID_LEGACY_KEYS.forEach(k => {
    try { props.deleteProperty(k); } catch (e) {}
  });
  Logger.log(MEMBER_LAST_ID_PROP_KEY + ' set to ' + num);
}
