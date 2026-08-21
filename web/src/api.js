const API_URL = (import.meta.env.VITE_API_URL || '').trim();
const inflight = new Map();

const TOKEN_KEY = 'hrm.apiToken.v1';
const PROFILE_KEY = 'hrm.staffProfile.v1';

// Apps Script는 콜드 스타트에서 30초를 넘기는 경우가 있어 기본 대기 시간을 넉넉히 잡는다.
const DEFAULT_TIMEOUT_MS = 45000;

// 데이터를 바꾸지 않는 작업만 자동 재시도한다. 쓰기 작업은 중복 처리를 막기 위해 한 번만 보낸다.
const SAFE_ACTIONS = new Set([
  'ping',
  'getDepartmentList',
  'getMemberHeaders',
  'searchMembers',
  'checkAuthAndLoadData',
  'verifyMemberLogin',
  'findSelfMemberCandidates',
  'getPendingRequests',
  'getDetailedHistory',
  'searchMembersForPhoto',
  'getPhotoQueueStatus',
  'getMemberCardFilterOptions',
  'getMemberCardsData',
]);

// 서버가 정상 응답을 주지 못한 경우에만 재시도한다. 업무 오류(server_error)는 재시도하지 않는다.
const RETRYABLE_CODES = new Set(['timeout', 'network', 'http_error', 'invalid_response']);
const SESSION_LOST_CODES = new Set(['auth_required', 'session_expired']);

class ApiError extends Error {
  constructor(message, code = 'api_error') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function cacheRead(key, ttl) {
  try {
    const item = JSON.parse(localStorage.getItem(key) || 'null');
    if (item && Date.now() - item.ts < ttl) return item.value;
  } catch (_) { /* ignore damaged cache */ }
  return null;
}

function cacheWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value })); } catch (_) { /* quota */ }
}

function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function notifySessionLost(error) {
  clearStaffSession();
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('hrm:session-expired', { detail: { message: error.message } }));
  } catch (_) { /* 구형 브라우저 */ }
}

async function requestOnce(action, params, timeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const authToken = readToken();
    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      signal: controller?.signal,
      body: JSON.stringify({ action, ...params, ...(authToken ? { authToken } : {}) }),
    });
    if (!response.ok) throw new ApiError(`서버 응답 오류 (HTTP ${response.status})`, 'http_error');
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (_) {
      throw new ApiError('API가 JSON 대신 다른 문서를 반환했습니다. Apps Script 배포 권한과 URL을 확인해 주세요.', 'invalid_response');
    }
    if (!data.ok) throw new ApiError(data.message || '요청 처리 중 오류가 발생했습니다.', data.error || 'server_error');
    return data.result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') throw new ApiError('응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.', 'timeout');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError('인터넷 연결이 끊겼습니다. 연결 후 다시 시도해 주세요.', 'offline');
    }
    throw new ApiError('서버에 연결할 수 없습니다. Apps Script 배포 상태를 확인해 주세요.', 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function callApi(action, params = {}, options = {}) {
  if (!API_URL) {
    throw new ApiError('API 주소가 설정되지 않았습니다. web/.env.local의 VITE_API_URL을 확인해 주세요.', 'missing_url');
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.retries != null
    ? options.retries + 1
    : (SAFE_ACTIONS.has(action) ? 3 : 1);
  // 재시도까지 포함한 전체 대기 상한. 사용자가 무한정 기다리지 않도록 묶어 둔다.
  const deadline = Date.now() + (options.totalBudgetMs || timeoutMs * 2);

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await requestOnce(action, params, timeoutMs);
    } catch (error) {
      lastError = error;
      if (SESSION_LOST_CODES.has(error.code)) {
        notifySessionLost(error);
        throw error;
      }
      const canRetry = attempt < maxAttempts
        && RETRYABLE_CODES.has(error.code)
        && Date.now() < deadline - 5000;
      if (!canRetry) throw error;
      await delay(attempt === 1 ? 600 : 1500);
    }
  }
  throw lastError;
}

function cachedCall(cacheKey, ttl, action, params = {}) {
  const cached = cacheRead(cacheKey, ttl);
  if (cached !== null) return Promise.resolve(cached);
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const promise = callApi(action, params)
    .then((value) => {
      cacheWrite(cacheKey, value);
      return value;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, promise);
  return promise;
}

export const api = {
  departments: () => cachedCall('hrm.departments.v2', 6 * 60 * 60 * 1000, 'getDepartmentList'),
  memberHeaders: () => cachedCall('hrm.headers.v2', 30 * 60 * 1000, 'getMemberHeaders'),
  memberCardFilters: () => cachedCall('hrm.cardFilters.v2', 15 * 60 * 1000, 'getMemberCardFilterOptions'),
  searchMembers: (keyword) => callApi('searchMembers', { keyword }),
  staffLogin: async (email, password) => {
    clearStaffSession();
    const result = await callApi('checkAuthAndLoadData', { email, password });
    writeStaffSession(result);
    return result;
  },
  selfCandidates: (name, memberId, departmentName) => callApi('findSelfMemberCandidates', { name, memberId, departmentName }),
  verifyMember: (name, memberId, departmentName) => callApi('verifyMemberLogin', { name, memberId, departmentName }),
  reconsent: (memberId, type = 'WEB_SELF') => callApi('submitReconsent', { memberId, type }),
  reconsentByToken: (token, version) => callApi('submitReconsentByToken', { token, version }),
  submitRequest: (form) => callApi('submitRequest', { form }, { timeoutMs: 90000 }),
  pendingRequests: () => callApi('getPendingRequests'),
  processRequest: (requestId, decision, adminEmail) => callApi('processAdminAction', { requestId, decision, adminEmail }, { timeoutMs: 60000 }),
  audit: (mode, p1, p2, header) => callApi('getDetailedHistory', { mode, p1, p2, header }),
  bulkUpdate: (fileId, adminEmail) => callApi('runExternalBulkUpdate', { fileId, adminEmail }, { timeoutMs: 120000 }),
  bulkRegister: (fileId, adminEmail) => callApi('runExternalBulkRegister', { fileId, adminEmail }, { timeoutMs: 120000 }),
  exportExcel: (headers) => callApi('exportToExcel', { headers }, { timeoutMs: 120000 }),
  photoSearch: (name) => callApi('searchMembersForPhoto', { name }),
  uploadPhoto: (payload) => callApi('uploadMemberPhotoDirect', payload, { timeoutMs: 120000 }),
  cardData: (mode, keyword, sortBy) => callApi('getMemberCardsData', { mode, keyword, sortBy }, { timeoutMs: 60000 }),
  cardPdfBatch: (payload) => callApi('generateMemberCardsPdfBatch', payload, { timeoutMs: 120000 }),
};

/** 로그인 결과를 탭 세션에 보관해 새로고침해도 다시 로그인하지 않도록 한다. */
function writeStaffSession(login) {
  if (!login) return;
  try {
    sessionStorage.setItem(TOKEN_KEY, login.apiToken || '');
    sessionStorage.setItem(PROFILE_KEY, JSON.stringify({
      role: login.role,
      email: login.email,
      userName: login.userName,
      departments: login.departments || [],
      expiresAt: login.apiTokenExpiresAt || '',
    }));
  } catch (_) { /* private mode */ }
}

/** 새로고침 직후 복구할 수 있는 유효한 담당자 세션을 돌려준다. 없으면 null. */
export function readStaffSession() {
  const token = readToken();
  if (!token) return null;
  let profile;
  try { profile = JSON.parse(sessionStorage.getItem(PROFILE_KEY) || 'null'); } catch (_) { return null; }
  if (!profile || !profile.role || profile.role === 'NONE') return null;
  if (profile.expiresAt && Date.parse(profile.expiresAt) <= Date.now()) {
    clearStaffSession();
    return null;
  }
  return profile;
}

export function clearStaffSession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(PROFILE_KEY);
  } catch (_) { /* ignore */ }
}

export function clearReferenceCache() {
  ['hrm.departments.v2', 'hrm.headers.v2', 'hrm.cardFilters.v2'].forEach((key) => {
    try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
  });
}
